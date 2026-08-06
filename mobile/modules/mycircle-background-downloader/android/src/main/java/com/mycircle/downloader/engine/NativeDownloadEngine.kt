package com.mycircle.downloader.engine

import android.content.Context
import com.mycircle.downloader.db.NativeSQLiteHelper
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class NativeDownloadEngine private constructor(private val context: Context) {

    private val db = NativeSQLiteHelper.getInstance(context)
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val activeJobs = ConcurrentHashMap<String, Job>()

    var onProgressEvent: ((Map<String, Any?>) -> Unit)? = null
    var onTaskCompletedEvent: ((Map<String, Any?>) -> Unit)? = null
    var onUrlExpiredEvent: ((Map<String, Any?>) -> Unit)? = null

    private var lastEmitTime: Long = 0

    companion object {
        @Volatile
        private var instance: NativeDownloadEngine? = null

        fun getInstance(context: Context): NativeDownloadEngine {
            return instance ?: synchronized(this) {
                instance ?: NativeDownloadEngine(context.applicationContext).also { instance = it }
            }
        }
    }

    fun downloadItem(taskId: String, batchId: String, url: String, destinationRelativePath: String, expectedSizeBytes: Long) {
        db.updateTaskStatus(taskId, "DOWNLOADING")

        val job = scope.launch {
            try {
                val request = Request.Builder().url(url).build()
                val response = client.newCall(request).execute()

                if (response.code == 403 || response.code == 410) {
                    db.updateTaskStatus(taskId, "URL_EXPIRED", errorMessage = "HTTP ${response.code} Signed URL expired")
                    onUrlExpiredEvent?.invoke(mapOf(
                        "taskId" to taskId,
                        "batchId" to batchId,
                        "statusCode" to response.code
                    ))
                    return@launch
                }

                if (!response.isSuccessful) {
                    db.updateTaskStatus(taskId, "FAILED", errorMessage = "HTTP ${response.code}")
                    return@launch
                }

                val body = response.body ?: run {
                    db.updateTaskStatus(taskId, "FAILED", errorMessage = "Empty HTTP body")
                    return@launch
                }

                val destFile = File(context.filesDir, destinationRelativePath)
                destFile.parentFile?.mkdirs()

                var downloadedBytes = 0L
                val totalBytes = body.contentLength().takeIf { it > 0 } ?: expectedSizeBytes

                body.byteStream().use { input ->
                    FileOutputStream(destFile).use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        var lastProgressReport = 0L

                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            if (!isActive) break
                            output.write(buffer, 0, bytesRead)
                            downloadedBytes += bytesRead

                            val now = System.currentTimeMillis()
                            if (now - lastProgressReport > 250) {
                                lastProgressReport = now
                                db.updateTaskStatus(taskId, "DOWNLOADING", downloadedBytes)
                                emitBatchProgressThrottled(batchId)
                            }
                        }
                    }
                }

                if (isActive) {
                    if (expectedSizeBytes > 0 && Math.abs(destFile.length() - expectedSizeBytes) > 1024 * 10) {
                        db.updateTaskStatus(taskId, "FAILED", destFile.length(), "File size mismatch")
                    } else {
                        db.updateTaskStatus(taskId, "COMPLETED", destFile.length())
                        onTaskCompletedEvent?.invoke(mapOf(
                            "taskId" to taskId,
                            "batchId" to batchId,
                            "localUri" to destFile.absolutePath
                        ))
                    }
                    emitBatchProgressThrottled(batchId)
                }

            } catch (e: Exception) {
                db.updateTaskStatus(taskId, "FAILED", errorMessage = e.localizedMessage ?: "Download failed")
                emitBatchProgressThrottled(batchId)
            } finally {
                activeJobs.remove(taskId)
            }
        }

        activeJobs[taskId] = job
    }

    fun pauseBatch(batchId: String) {
        val pendingTasks = db.getPendingTasksForBatch(batchId)
        for (task in pendingTasks) {
            activeJobs[task.id]?.cancel()
            activeJobs.remove(task.id)
        }
        db.updateBatchStatus(batchId, "PAUSED")
        emitBatchProgressThrottled(batchId)
    }

    fun resumeBatch(batchId: String) {
        db.updateBatchStatus(batchId, "DOWNLOADING")
        val pendingTasks = db.getPendingTasksForBatch(batchId)
        for (task in pendingTasks) {
            downloadItem(task.id, batchId, task.url, task.destinationPath, task.expectedSizeBytes)
        }
        emitBatchProgressThrottled(batchId)
    }

    fun cancelBatch(batchId: String) {
        val pendingTasks = db.getPendingTasksForBatch(batchId)
        for (task in pendingTasks) {
            activeJobs[task.id]?.cancel()
            activeJobs.remove(task.id)
        }
        db.updateBatchStatus(batchId, "CANCELLED")
        emitBatchProgressThrottled(batchId)
    }

    fun cancelTask(taskId: String) {
        activeJobs[taskId]?.cancel()
        activeJobs.remove(taskId)
        db.updateTaskStatus(taskId, "CANCELLED")
    }


    private fun emitBatchProgressThrottled(batchId: String) {
        val now = System.currentTimeMillis()
        if (now - lastEmitTime < 250) return
        lastEmitTime = now

        db.getBatchStatus(batchId)?.let { status ->
            onProgressEvent?.invoke(status)
        }
    }
}
