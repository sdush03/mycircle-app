import Foundation
import SQLite3

public final class NativeQueueDatabase {
    public static let shared = NativeQueueDatabase()
    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "com.mycircle.downloader.db", qos: .utility)

    private init() {
        openDatabase()
        createTables()
    }

    deinit {
        if db != nil {
            sqlite3_close(db)
        }
    }

    private func openDatabase() {
        let fileManager = FileManager.default
        guard let docsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            print("[MyCircleDB] Error: Could not locate documents directory.")
            return
        }
        
        let dbURL = docsURL.appendingPathComponent("mycircle_downloader.db")
        if sqlite3_open_v2(dbURL.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) != SQLITE_OK {
            print("[MyCircleDB] Error opening database at \(dbURL.path)")
        } else {
            print("[MyCircleDB] Successfully opened SQLite database at \(dbURL.path)")
        }
    }

    private func createTables() {
        let createBatchesSQL = """
        CREATE TABLE IF NOT EXISTS download_batches (
            id TEXT PRIMARY KEY NOT NULL,
            deduplication_key TEXT,
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
        """
        executeRaw(sql: createBatchesSQL)
        executeRaw(sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_dedup ON download_batches(deduplication_key) WHERE deduplication_key IS NOT NULL;")


        let createTasksSQL = """
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
        """

        let createIndicesSQL = """
        CREATE INDEX IF NOT EXISTS idx_tasks_batch_status ON download_tasks(batch_id, status);
        CREATE INDEX IF NOT EXISTS idx_tasks_queue ON download_tasks(status, priority DESC, created_at ASC);
        """

        executeRaw(sql: createBatchesSQL)
        executeRaw(sql: createTasksSQL)
        executeRaw(sql: createIndicesSQL)
    }

    private func executeRaw(sql: String) {
        queue.sync {
            var statement: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK {
                if sqlite3_step(statement) != SQLITE_DONE {
                    let errmsg = String(cString: sqlite3_errmsg(db))
                    print("[MyCircleDB] Exec raw error: \(errmsg)")
                }
            } else {
                let errmsg = String(cString: sqlite3_errmsg(db))
                print("[MyCircleDB] Prepare raw error: \(errmsg)")
            }
            sqlite3_finalize(statement)
        }
    }

    // MARK: - Batch Operations

    public func enqueueBatch(
        batchId: String,
        title: String,
        sourceType: String,
        exportMode: String,
        tasks: [[String: Any]],
        overwrite: Bool = false
    ) -> [String: Any] {
        return queue.sync {
            let dedupKey = "\(sourceType)_\(title.lowercased().replacingOccurrences(of: " ", with: "_"))"
            
            // Check for existing batch with same deduplication key or title
            if !overwrite {
                let checkBatchSQL = "SELECT id, status FROM download_batches WHERE deduplication_key = ? OR title = ? LIMIT 1;"
                var checkStmt: OpaquePointer?
                if sqlite3_prepare_v2(db, checkBatchSQL, -1, &checkStmt, nil) == SQLITE_OK {
                    sqlite3_bind_text(checkStmt, 1, (dedupKey as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(checkStmt, 2, (title as NSString).utf8String, -1, nil)
                    if sqlite3_step(checkStmt) == SQLITE_ROW {
                        if let existingId = sqlite3_column_text(checkStmt, 0) {
                            let exIdStr = String(cString: existingId)
                            sqlite3_finalize(checkStmt)
                            return [
                                "success": true,
                                "isDuplicate": true,
                                "batchId": exIdStr
                            ]
                        }
                    }
                }
                sqlite3_finalize(checkStmt)
            }

            executeRaw(sql: "BEGIN TRANSACTION;")
            
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            var totalBytes: Int64 = 0
            
            for task in tasks {
                if let size = task["expectedSizeBytes"] as? NSNumber {
                    totalBytes += size.int64Value
                }
            }
            
            let insertBatchSQL = """
            INSERT INTO download_batches (id, deduplication_key, title, source_type, export_mode, total_files, total_bytes, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
            status = excluded.status, updated_at = excluded.updated_at;
            """
            
            var batchStmt: OpaquePointer?
            if sqlite3_prepare_v2(db, insertBatchSQL, -1, &batchStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(batchStmt, 1, (batchId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(batchStmt, 2, (dedupKey as NSString).utf8String, -1, nil)
                sqlite3_bind_text(batchStmt, 3, (title as NSString).utf8String, -1, nil)
                sqlite3_bind_text(batchStmt, 4, (sourceType as NSString).utf8String, -1, nil)
                sqlite3_bind_text(batchStmt, 5, (exportMode as NSString).utf8String, -1, nil)
                sqlite3_bind_int(batchStmt, 6, Int32(tasks.count))
                sqlite3_bind_int64(batchStmt, 7, totalBytes)
                sqlite3_bind_text(batchStmt, 8, "QUEUED", -1, nil)
                sqlite3_bind_int64(batchStmt, 9, now)
                sqlite3_bind_int64(batchStmt, 10, now)
                
                if sqlite3_step(batchStmt) != SQLITE_DONE {
                    let errmsg = String(cString: sqlite3_errmsg(db))
                    print("[MyCircleDB] Failed to insert batch \(batchId): \(errmsg)")
                    sqlite3_finalize(batchStmt)
                    executeRaw(sql: "ROLLBACK;")
                    return ["success": false, "isDuplicate": false, "batchId": batchId]
                }
            }
            sqlite3_finalize(batchStmt)

            for task in tasks {

                guard let taskId = task["id"] as? String,
                      let url = task["url"] as? String,
                      let destPath = task["destinationPath"] as? String,
                      let fileType = task["fileType"] as? String else { continue }
                
                let taskSourceType = (task["sourceType"] as? String) ?? sourceType
                let taskExportMode = (task["exportMode"] as? String) ?? exportMode
                let sizeBytes = (task["expectedSizeBytes"] as? NSNumber)?.int64Value ?? 0
                let checksum = task["expectedChecksumSha256"] as? String
                let priority = (task["priority"] as? NSNumber)?.int32Value ?? 1
                
                // Duplicate check: verify if destination file exists on disk OR completed in SQLite
                let docsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
                let fileURL = docsURL.appendingPathComponent(destPath)
                var initialStatus = "QUEUED"
                var initialDownloaded: Int64 = 0
                
                var isCompletedInDB = false
                let dupSQL = "SELECT downloaded_bytes FROM download_tasks WHERE (destination_relative_path = ? OR remote_url = ?) AND status = 'COMPLETED' LIMIT 1;"
                var dupStmt: OpaquePointer?
                if sqlite3_prepare_v2(db, dupSQL, -1, &dupStmt, nil) == SQLITE_OK {
                    sqlite3_bind_text(dupStmt, 1, (destPath as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(dupStmt, 2, (url as NSString).utf8String, -1, nil)
                    if sqlite3_step(dupStmt) == SQLITE_ROW {
                        isCompletedInDB = true
                        initialDownloaded = sqlite3_column_int64(dupStmt, 0)
                    }
                }
                sqlite3_finalize(dupStmt)

                let fileExistsOnDisk = FileManager.default.fileExists(atPath: fileURL.path)
                if fileExistsOnDisk {
                    let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
                    let existingSize = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
                    if existingSize > 0 {
                        initialStatus = "COMPLETED"
                        initialDownloaded = existingSize
                    }
                } else if isCompletedInDB {
                    initialStatus = "COMPLETED"
                }

                var taskStmt: OpaquePointer?
                let insertTaskSQL = """
                INSERT INTO download_tasks (id, batch_id, remote_url, destination_relative_path, file_type, source_type, export_mode, expected_size_bytes, downloaded_bytes, expected_checksum_sha256, priority, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                remote_url = excluded.remote_url, status = excluded.status, downloaded_bytes = excluded.downloaded_bytes, updated_at = excluded.updated_at;
                """
                if sqlite3_prepare_v2(db, insertTaskSQL, -1, &taskStmt, nil) == SQLITE_OK {
                    sqlite3_bind_text(taskStmt, 1, (taskId as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(taskStmt, 2, (batchId as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(taskStmt, 3, (url as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(taskStmt, 4, (destPath as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(taskStmt, 5, (fileType as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(taskStmt, 6, (taskSourceType as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(taskStmt, 7, (taskExportMode as NSString).utf8String, -1, nil)
                    sqlite3_bind_int64(taskStmt, 8, sizeBytes)
                    sqlite3_bind_int64(taskStmt, 9, initialDownloaded)
                    if let cs = checksum {
                        sqlite3_bind_text(taskStmt, 10, (cs as NSString).utf8String, -1, nil)
                    } else {
                        sqlite3_bind_null(taskStmt, 10)
                    }
                    sqlite3_bind_int(taskStmt, 11, priority)
                    sqlite3_bind_text(taskStmt, 12, (initialStatus as NSString).utf8String, -1, nil)
                    sqlite3_bind_int64(taskStmt, 13, now)
                    sqlite3_bind_int64(taskStmt, 14, now)
                    
                    _ = sqlite3_step(taskStmt)
                }
                sqlite3_finalize(taskStmt)
            }

            executeRaw(sql: "COMMIT;")
            
            if let firstTask = tasks.first, let firstTaskId = firstTask["id"] as? String {
                recalculateBatchStatus(taskId: firstTaskId)
            }
            return ["success": true, "isDuplicate": false, "batchId": batchId]
        }
    }



    public struct TaskRow {
        public let id: String
        public let url: String
        public let destinationPath: String
        public let expectedSizeBytes: Int64
    }

    public func getPendingTasksForBatch(batchId: String) -> [TaskRow] {
        return queue.sync {
            let sql = """
            SELECT id, remote_url, destination_relative_path, expected_size_bytes
            FROM download_tasks WHERE batch_id = ? AND status != 'COMPLETED';
            """
            var stmt: OpaquePointer?
            var rows: [TaskRow] = []
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (batchId as NSString).utf8String, -1, nil)
                while sqlite3_step(stmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(stmt, 0))
                    let url = String(cString: sqlite3_column_text(stmt, 1))
                    let destPath = String(cString: sqlite3_column_text(stmt, 2))
                    let size = sqlite3_column_int64(stmt, 3)
                    rows.append(TaskRow(id: id, url: url, destinationPath: destPath, expectedSizeBytes: size))
                }
            }
            sqlite3_finalize(stmt)
            return rows
        }
    }


    public func updateTaskStatus(taskId: String, status: String, downloadedBytes: Int64 = 0, errorMessage: String? = nil) {
        queue.sync {
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let sql = """
            UPDATE download_tasks SET status = ?, downloaded_bytes = max(downloaded_bytes, ?), last_error_message = ?, updated_at = ? WHERE id = ?;
            """
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (status as NSString).utf8String, -1, nil)
                sqlite3_bind_int64(stmt, 2, downloadedBytes)
                if let err = errorMessage {
                    sqlite3_bind_text(stmt, 3, (err as NSString).utf8String, -1, nil)
                } else {
                    sqlite3_bind_null(stmt, 3)
                }
                sqlite3_bind_int64(stmt, 4, now)
                sqlite3_bind_text(stmt, 5, (taskId as NSString).utf8String, -1, nil)
                _ = sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)
            
            recalculateBatchStatus(taskId: taskId)
        }
    }

    public func updateBatchStatus(batchId: String, status: String) {
        queue.sync {
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let sql = "UPDATE download_batches SET status = ?, updated_at = ? WHERE id = ?;"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (status as NSString).utf8String, -1, nil)
                sqlite3_bind_int64(stmt, 2, now)
                sqlite3_bind_text(stmt, 3, (batchId as NSString).utf8String, -1, nil)
                _ = sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)
            
            let updateTasksSQL = "UPDATE download_tasks SET status = ?, updated_at = ? WHERE batch_id = ? AND status != 'COMPLETED';"
            var taskStmt: OpaquePointer?
            if sqlite3_prepare_v2(db, updateTasksSQL, -1, &taskStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(taskStmt, 1, (status as NSString).utf8String, -1, nil)
                sqlite3_bind_int64(taskStmt, 2, now)
                sqlite3_bind_text(taskStmt, 3, (batchId as NSString).utf8String, -1, nil)
                _ = sqlite3_step(taskStmt)
            }
            sqlite3_finalize(taskStmt)
        }
    }

    public func updateTaskUrl(taskId: String, newUrl: String) -> Bool {
        return queue.sync {
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let sql = "UPDATE download_tasks SET remote_url = ?, status = 'QUEUED', updated_at = ? WHERE id = ?;"
            var stmt: OpaquePointer?
            var success = false
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (newUrl as NSString).utf8String, -1, nil)
                sqlite3_bind_int64(stmt, 2, now)
                sqlite3_bind_text(stmt, 3, (taskId as NSString).utf8String, -1, nil)
                if sqlite3_step(stmt) == SQLITE_DONE {
                    success = true
                }
            }
            sqlite3_finalize(stmt)
            return success
        }
    }

    private func recalculateBatchStatus(taskId: String) {
        let getBatchIdSQL = "SELECT batch_id FROM download_tasks WHERE id = ?;"
        var batchId: String?
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, getBatchIdSQL, -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, (taskId as NSString).utf8String, -1, nil)
            if sqlite3_step(stmt) == SQLITE_ROW {
                if let str = sqlite3_column_text(stmt, 0) {
                    batchId = String(cString: str)
                }
            }
        }
        sqlite3_finalize(stmt)
        
        guard let bId = batchId else { return }

        let recalcSQL = """
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
            SUM(downloaded_bytes) as downloaded_bytes
        FROM download_tasks WHERE batch_id = ?;
        """
        
        var recalcStmt: OpaquePointer?
        if sqlite3_prepare_v2(db, recalcSQL, -1, &recalcStmt, nil) == SQLITE_OK {
            sqlite3_bind_text(recalcStmt, 1, (bId as NSString).utf8String, -1, nil)
            if sqlite3_step(recalcStmt) == SQLITE_ROW {
                let total = sqlite3_column_int(recalcStmt, 0)
                let completed = sqlite3_column_int(recalcStmt, 1)
                let failed = sqlite3_column_int(recalcStmt, 2)
                let downloadedBytes = sqlite3_column_int64(recalcStmt, 3)
                
                var newStatus = "DOWNLOADING"
                if completed == total {
                    newStatus = "COMPLETED"
                } else if (completed + failed) == total {
                    newStatus = "FAILED"
                }
                
                let updateBatchSQL = """
                UPDATE download_batches SET completed_files = ?, failed_files = ?, downloaded_bytes = ?, status = ?, updated_at = ? WHERE id = ?;
                """
                var uStmt: OpaquePointer?
                if sqlite3_prepare_v2(db, updateBatchSQL, -1, &uStmt, nil) == SQLITE_OK {
                    sqlite3_bind_int(uStmt, 1, completed)
                    sqlite3_bind_int(uStmt, 2, failed)
                    sqlite3_bind_int64(uStmt, 3, downloadedBytes)
                    sqlite3_bind_text(uStmt, 4, (newStatus as NSString).utf8String, -1, nil)
                    sqlite3_bind_int64(uStmt, 5, Int64(Date().timeIntervalSince1970 * 1000))
                    sqlite3_bind_text(uStmt, 6, (bId as NSString).utf8String, -1, nil)
                    _ = sqlite3_step(uStmt)
                }
                sqlite3_finalize(uStmt)
            }
        }
        sqlite3_finalize(recalcStmt)
    }

    public func getAllBatches() -> [[String: Any]] {
        return queue.sync {
            let sql = """
            SELECT id, title, source_type, export_mode, total_files, completed_files, failed_files, total_bytes, downloaded_bytes, status
            FROM download_batches ORDER BY created_at DESC;
            """
            var stmt: OpaquePointer?
            var results: [[String: Any]] = []
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                while sqlite3_step(stmt) == SQLITE_ROW {
                    let batch: [String: Any] = [
                        "batchId": String(cString: sqlite3_column_text(stmt, 0)),
                        "title": String(cString: sqlite3_column_text(stmt, 1)),
                        "sourceType": String(cString: sqlite3_column_text(stmt, 2)),
                        "exportMode": String(cString: sqlite3_column_text(stmt, 3)),
                        "totalFiles": Int(sqlite3_column_int(stmt, 4)),
                        "completedFiles": Int(sqlite3_column_int(stmt, 5)),
                        "failedFiles": Int(sqlite3_column_int(stmt, 6)),
                        "totalBytes": Int64(sqlite3_column_int64(stmt, 7)),
                        "downloadedBytes": Int64(sqlite3_column_int64(stmt, 8)),
                        "status": String(cString: sqlite3_column_text(stmt, 9))
                    ]
                    results.append(batch)
                }
            }
            sqlite3_finalize(stmt)
            return results
        }
    }

    public func clearQueue() {
        queue.sync {
            executeRaw(sql: "DELETE FROM download_tasks;")
            executeRaw(sql: "DELETE FROM download_batches;")
        }
    }

    public func getBatchStatus(batchId: String) -> [String: Any]? {
        return queue.sync {
            let sql = """
            SELECT id, title, source_type, export_mode, total_files, completed_files, failed_files, total_bytes, downloaded_bytes, status
            FROM download_batches WHERE id = ?;
            """
            var stmt: OpaquePointer?
            var result: [String: Any]?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (batchId as NSString).utf8String, -1, nil)
                if sqlite3_step(stmt) == SQLITE_ROW {
                    result = [
                        "batchId": String(cString: sqlite3_column_text(stmt, 0)),
                        "title": String(cString: sqlite3_column_text(stmt, 1)),
                        "sourceType": String(cString: sqlite3_column_text(stmt, 2)),
                        "exportMode": String(cString: sqlite3_column_text(stmt, 3)),
                        "totalFiles": Int(sqlite3_column_int(stmt, 4)),
                        "completedFiles": Int(sqlite3_column_int(stmt, 5)),
                        "failedFiles": Int(sqlite3_column_int(stmt, 6)),
                        "totalBytes": Int64(sqlite3_column_int64(stmt, 7)),
                        "downloadedBytes": Int64(sqlite3_column_int64(stmt, 8)),
                        "status": String(cString: sqlite3_column_text(stmt, 9))
                    ]
                }
            }
            sqlite3_finalize(stmt)
            return result
        }
    }
}

