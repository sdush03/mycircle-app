package com.mycircle.downloader.db

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class NativeSQLiteHelper(private val context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {


    companion object {
        private const val DATABASE_NAME = "mycircle_downloader.db"
        private const val DATABASE_VERSION = 1

        @Volatile
        private var instance: NativeSQLiteHelper? = null

        fun getInstance(context: Context): NativeSQLiteHelper {
            return instance ?: synchronized(this) {
                instance ?: NativeSQLiteHelper(context.applicationContext).also { instance = it }
            }
        }
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createBatchesSQL = """
            CREATE TABLE IF NOT EXISTS download_batches (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                source_type TEXT NOT NULL,
                export_mode TEXT NOT NULL DEFAULT 'MYCIRCLE_ONLY',
                total_files INTEGER NOT NULL,
                completed_files INTEGER NOT NULL DEFAULT 0,
                failed_files INTEGER NOT NULL DEFAULT 0,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                downloaded_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'QUEUED',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """.trimIndent()

        val createTasksSQL = """
            CREATE TABLE IF NOT EXISTS download_tasks (
                id TEXT PRIMARY KEY NOT NULL,
                batch_id TEXT NOT NULL,
                remote_url TEXT NOT NULL,
                destination_relative_path TEXT NOT NULL,
                file_type TEXT NOT NULL,
                source_type TEXT NOT NULL,
                export_mode TEXT NOT NULL DEFAULT 'MYCIRCLE_ONLY',
                expected_size_bytes INTEGER NOT NULL DEFAULT 0,
                downloaded_bytes INTEGER NOT NULL DEFAULT 0,
                expected_checksum_sha256 TEXT,
                resume_data_blob BLOB,
                status TEXT NOT NULL DEFAULT 'QUEUED',
                retry_count INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 5,
                priority INTEGER NOT NULL DEFAULT 1,
                last_error_message TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(batch_id) REFERENCES download_batches(id) ON DELETE CASCADE
            );
        """.trimIndent()

        val createIndicesSQL = """
            CREATE INDEX IF NOT EXISTS idx_tasks_batch_status ON download_tasks(batch_id, status);
            CREATE INDEX IF NOT EXISTS idx_tasks_queue ON download_tasks(status, priority DESC, created_at ASC);
        """.trimIndent()

        db.execSQL(createBatchesSQL)
        db.execSQL(createTasksSQL)
        db.execSQL(createIndicesSQL)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS download_tasks")
        db.execSQL("DROP TABLE IF EXISTS download_batches")
        onCreate(db)
    }

    fun enqueueBatch(
        batchId: String,
        title: String,
        sourceType: String,
        exportMode: String,
        tasks: List<Map<String, Any?>>,
        overwrite: Boolean = false
    ): Map<String, Any?> {
        val db = writableDatabase
        val dedupKey = "${sourceType}_${title.lowercase().replace(" ", "_")}"

        if (!overwrite) {
            val checkSql = "SELECT id, status FROM download_batches WHERE title = ? LIMIT 1"
            db.rawQuery(checkSql, arrayOf(title)).use { cursor ->
                if (cursor.moveToFirst()) {
                    val existingId = cursor.getString(0)
                    return mapOf(
                        "success" to true,
                        "isDuplicate" to true,
                        "batchId" to existingId
                    )
                }
            }
        }

        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            var totalBytes: Long = 0

            for (task in tasks) {
                val size = (task["expectedSizeBytes"] as? Number)?.toLong() ?: 0L
                totalBytes += size
            }

            val batchValues = ContentValues().apply {
                put("id", batchId)
                put("title", title)
                put("source_type", sourceType)
                put("export_mode", exportMode)
                put("total_files", tasks.size)
                put("total_bytes", totalBytes)
                put("status", "QUEUED")
                put("created_at", now)
                put("updated_at", now)
            }

            db.insertWithOnConflict("download_batches", null, batchValues, SQLiteDatabase.CONFLICT_REPLACE)


            for (task in tasks) {
                val taskId = task["id"] as? String ?: continue
                val url = task["url"] as? String ?: continue
                val destPath = task["destinationPath"] as? String ?: continue
                val fileType = task["fileType"] as? String ?: continue
                val taskSourceType = (task["sourceType"] as? String) ?: sourceType
                val taskExportMode = (task["exportMode"] as? String) ?: exportMode
                val sizeBytes = (task["expectedSizeBytes"] as? Number)?.toLong() ?: 0L
                val checksum = task["expectedChecksumSha256"] as? String
                val priority = (task["priority"] as? Number)?.toInt() ?: 1

                // Duplicate check: verify if file exists on disk
                val destFile = java.io.File(context.filesDir, destPath)
                var initialStatus = "QUEUED"
                var initialDownloaded = 0L
                if (destFile.exists() && destFile.length() > 0) {
                    initialStatus = "COMPLETED"
                    initialDownloaded = destFile.length()
                }

                val taskValues = ContentValues().apply {
                    put("id", taskId)
                    put("batch_id", batchId)
                    put("remote_url", url)
                    put("destination_relative_path", destPath)
                    put("file_type", fileType)
                    put("source_type", taskSourceType)
                    put("export_mode", taskExportMode)
                    put("expected_size_bytes", sizeBytes)
                    put("downloaded_bytes", initialDownloaded)
                    put("expected_checksum_sha256", checksum)
                    put("priority", priority)
                    put("status", initialStatus)
                    put("created_at", now)
                    put("updated_at", now)
                }

                db.insertWithOnConflict("download_tasks", null, taskValues, SQLiteDatabase.CONFLICT_REPLACE)
            }

            db.setTransactionSuccessful()
            if (tasks.isNotEmpty()) {
                val firstTaskId = tasks.first()["id"] as? String
                firstTaskId?.let { recalculateBatchStatus(it) }
            }
            return mapOf("success" to true, "isDuplicate" to false, "batchId" to batchId)
        } catch (e: Exception) {
            e.printStackTrace()
            return mapOf("success" to false, "isDuplicate" to false, "batchId" to batchId)
        } finally {
            db.endTransaction()
        }
    }


    data class TaskRow(
        val id: String,
        val url: String,
        val destinationPath: String,
        val expectedSizeBytes: Long
    )

    fun getPendingTasksForBatch(batchId: String): List<TaskRow> {
        val db = readableDatabase
        val list = mutableListOf<TaskRow>()
        val sql = "SELECT id, remote_url, destination_relative_path, expected_size_bytes FROM download_tasks WHERE batch_id = ? AND status != 'COMPLETED'"
        db.rawQuery(sql, arrayOf(batchId)).use { cursor ->
            while (cursor.moveToNext()) {
                list.add(TaskRow(
                    id = cursor.getString(0),
                    url = cursor.getString(1),
                    destinationPath = cursor.getString(2),
                    expectedSizeBytes = cursor.getLong(3)
                ))
            }
        }
        return list
    }


    fun updateTaskStatus(taskId: String, status: String, downloadedBytes: Long = 0L, errorMessage: String? = null) {
        val db = writableDatabase
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put("status", status)
            put("downloaded_bytes", downloadedBytes)
            put("last_error_message", errorMessage)
            put("updated_at", now)
        }
        db.update("download_tasks", values, "id = ?", arrayOf(taskId))
        recalculateBatchStatus(taskId)
    }

    fun updateBatchStatus(batchId: String, status: String) {
        val db = writableDatabase
        val now = System.currentTimeMillis()
        val batchValues = ContentValues().apply {
            put("status", status)
            put("updated_at", now)
        }
        db.update("download_batches", batchValues, "id = ?", arrayOf(batchId))

        val taskValues = ContentValues().apply {
            put("status", status)
            put("updated_at", now)
        }
        db.update("download_tasks", taskValues, "batch_id = ? AND status != 'COMPLETED'", arrayOf(batchId))
    }

    fun updateTaskUrl(taskId: String, newUrl: String): Boolean {
        val db = writableDatabase
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put("remote_url", newUrl)
            put("status", "QUEUED")
            put("updated_at", now)
        }
        val rows = db.update("download_tasks", values, "id = ?", arrayOf(taskId))
        return rows > 0
    }

    private fun recalculateBatchStatus(taskId: String) {
        val db = writableDatabase
        var batchId: String? = null

        db.rawQuery("SELECT batch_id FROM download_tasks WHERE id = ?", arrayOf(taskId)).use { cursor ->
            if (cursor.moveToFirst()) {
                batchId = cursor.getString(0)
            }
        }

        val bId = batchId ?: return

        val sql = """
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
                SUM(downloaded_bytes) as downloaded_bytes
            FROM download_tasks WHERE batch_id = ?
        """.trimIndent()

        db.rawQuery(sql, arrayOf(bId)).use { cursor ->
            if (cursor.moveToFirst()) {
                val total = cursor.getInt(0)
                val completed = cursor.getInt(1)
                val failed = cursor.getInt(2)
                val downloadedBytes = cursor.getLong(3)

                var newStatus = "DOWNLOADING"
                if (completed == total) {
                    newStatus = "COMPLETED"
                } else if ((completed + failed) == total) {
                    newStatus = "FAILED"
                }

                val values = ContentValues().apply {
                    put("completed_files", completed)
                    put("failed_files", failed)
                    put("downloaded_bytes", downloadedBytes)
                    put("status", newStatus)
                    put("updated_at", System.currentTimeMillis())
                }
                db.update("download_batches", values, "id = ?", arrayOf(bId))
            }
        }
    }

    fun getAllBatches(): List<Map<String, Any?>> {
        val db = readableDatabase
        val list = mutableListOf<Map<String, Any?>>()
        val sql = """
            SELECT id, title, source_type, export_mode, total_files, completed_files, failed_files, total_bytes, downloaded_bytes, status
            FROM download_batches ORDER BY created_at DESC
        """.trimIndent()

        db.rawQuery(sql, null).use { cursor ->
            while (cursor.moveToNext()) {
                list.add(mapOf(
                    "batchId" to cursor.getString(0),
                    "title" to cursor.getString(1),
                    "sourceType" to cursor.getString(2),
                    "exportMode" to cursor.getString(3),
                    "totalFiles" to cursor.getInt(4),
                    "completedFiles" to cursor.getInt(5),
                    "failedFiles" to cursor.getInt(6),
                    "totalBytes" to cursor.getLong(7),
                    "downloadedBytes" to cursor.getLong(8),
                    "status" to cursor.getString(9)
                ))
            }
        }
        return list
    }

    fun clearQueue() {
        val db = writableDatabase
        db.execSQL("DELETE FROM download_tasks")
        db.execSQL("DELETE FROM download_batches")
    }

    fun getBatchStatus(batchId: String): Map<String, Any?>? {
        val db = readableDatabase
        val sql = """
            SELECT id, title, source_type, export_mode, total_files, completed_files, failed_files, total_bytes, downloaded_bytes, status
            FROM download_batches WHERE id = ?
        """.trimIndent()

        db.rawQuery(sql, arrayOf(batchId)).use { cursor ->
            if (cursor.moveToFirst()) {
                return mapOf(
                    "batchId" to cursor.getString(0),
                    "title" to cursor.getString(1),
                    "sourceType" to cursor.getString(2),
                    "exportMode" to cursor.getString(3),
                    "totalFiles" to cursor.getInt(4),
                    "completedFiles" to cursor.getInt(5),
                    "failedFiles" to cursor.getInt(6),
                    "totalBytes" to cursor.getLong(7),
                    "downloadedBytes" to cursor.getLong(8),
                    "status" to cursor.getString(9)
                )
            }
        }
        return null
    }
}

