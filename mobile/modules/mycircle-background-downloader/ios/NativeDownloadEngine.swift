import Foundation
import ExpoModulesCore

public final class NativeDownloadEngine: NSObject, URLSessionDownloadDelegate {
    public static let shared = NativeDownloadEngine()
    private var session: URLSession!
    private var activeTasks: [Int: (taskId: String, batchId: String, destPath: String, expectedSize: Int64)] = [:]
    private let db = NativeQueueDatabase.shared
    
    // Throttled event emitter function set by Expo Module
    public var onProgressEvent: (([String: Any]) -> Void)?
    public var onTaskCompletedEvent: (([String: Any]) -> Void)?
    public var onUrlExpiredEvent: (([String: Any]) -> Void)?
    
    private var lastEmitTime: TimeInterval = 0

    private override init() {
        super.init()
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 6
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 6
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }

    public func downloadItem(taskId: String, batchId: String, urlString: String, destinationRelativePath: String, expectedSizeBytes: Int64) {
        guard let url = URL(string: urlString) else {
            db.updateTaskStatus(taskId: taskId, status: "FAILED", errorMessage: "Invalid URL")
            return
        }

        db.updateTaskStatus(taskId: taskId, status: "DOWNLOADING")
        
        let request = URLRequest(url: url)
        let downloadTask = session.downloadTask(with: request)
        downloadTask.taskDescription = "\(batchId)|\(taskId)"
        
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let destURL = documentsURL.appendingPathComponent(destinationRelativePath)
        
        // Ensure parent directory exists
        try? FileManager.default.createDirectory(at: destURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        
        activeTasks[downloadTask.taskIdentifier] = (taskId, batchId, destURL.path, expectedSizeBytes)
        downloadTask.resume()
    }

    public func pauseBatch(batchId: String) {
        session.getAllTasks { tasks in
            for task in tasks {
                if let desc = task.taskDescription, desc.hasPrefix("\(batchId)|") {
                    task.cancel()
                }
            }
        }
        db.updateBatchStatus(batchId: batchId, status: "PAUSED")
        emitBatchProgressThrottled(batchId: batchId)
    }

    public func resumeBatch(batchId: String) {
        db.updateBatchStatus(batchId: batchId, status: "DOWNLOADING")
        let pendingTasks = db.getPendingTasksForBatch(batchId: batchId)
        for task in pendingTasks {
            downloadItem(
                taskId: task.id,
                batchId: batchId,
                urlString: task.url,
                destinationRelativePath: task.destinationPath,
                expectedSizeBytes: task.expectedSizeBytes
            )
        }
        emitBatchProgressThrottled(batchId: batchId)
    }

    public func cancelBatch(batchId: String) {
        session.getAllTasks { tasks in
            for task in tasks {
                if let desc = task.taskDescription, desc.hasPrefix("\(batchId)|") {
                    task.cancel()
                }
            }
        }
        db.updateBatchStatus(batchId: batchId, status: "CANCELLED")
        emitBatchProgressThrottled(batchId: batchId)
    }

    public func cancelTask(taskId: String) {
        session.getAllTasks { tasks in
            for task in tasks {
                if let desc = task.taskDescription, desc.contains("|\(taskId)") {
                    task.cancel()
                }
            }
        }
        db.updateTaskStatus(taskId: taskId, status: "CANCELLED")
    }


    // MARK: - URLSessionDownloadDelegate

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let info = activeTasks[downloadTask.taskIdentifier] else { return }
        
        let destURL = URL(fileURLWithPath: info.destPath)
        let fileManager = FileManager.default
        
        do {
            if fileManager.fileExists(atPath: destURL.path) {
                try fileManager.removeItem(at: destURL)
            }
            try fileManager.moveItem(at: location, to: destURL)
            
            // Default verification: verify file size matches Content-Length / expected size if provided (> 0)
            let attributes = try fileManager.attributesOfItem(atPath: destURL.path)
            let fileSize = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            
            if info.expectedSize > 0 && abs(fileSize - info.expectedSize) > 1024 * 10 {
                // Size mismatch error
                db.updateTaskStatus(taskId: info.taskId, status: "FAILED", downloadedBytes: fileSize, errorMessage: "File size mismatch")
            } else {
                db.updateTaskStatus(taskId: info.taskId, status: "COMPLETED", downloadedBytes: fileSize)
                onTaskCompletedEvent?([
                    "taskId": info.taskId,
                    "batchId": info.batchId,
                    "localUri": destURL.path
                ])
            }
        } catch {
            db.updateTaskStatus(taskId: info.taskId, status: "FAILED", errorMessage: error.localizedDescription)
        }
        
        activeTasks.removeValue(forKey: downloadTask.taskIdentifier)
        emitBatchProgressThrottled(batchId: info.batchId)
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let info = activeTasks[downloadTask.taskIdentifier] else { return }
        db.updateTaskStatus(taskId: info.taskId, status: "DOWNLOADING", downloadedBytes: totalBytesWritten)
        emitBatchProgressThrottled(batchId: info.batchId)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let info = activeTasks[task.taskIdentifier] else { return }
        
        if let response = task.response as? HTTPURLResponse {
            // Check for HTTP 403 Forbidden or 410 Gone (Signed URL expired)
            if response.statusCode == 403 || response.statusCode == 410 {
                db.updateTaskStatus(taskId: info.taskId, status: "URL_EXPIRED", errorMessage: "HTTP \(response.statusCode) Signed URL expired")
                onUrlExpiredEvent?([
                    "taskId": info.taskId,
                    "batchId": info.batchId,
                    "statusCode": response.statusCode
                ])
                activeTasks.removeValue(forKey: task.taskIdentifier)
                return
            }
        }

        if let error = error {
            let nsError = error as NSError
            if nsError.code != NSURLErrorCancelled {
                db.updateTaskStatus(taskId: info.taskId, status: "FAILED", errorMessage: error.localizedDescription)
            }
        }
        
        activeTasks.removeValue(forKey: task.taskIdentifier)
        emitBatchProgressThrottled(batchId: info.batchId)
    }

    private func emitBatchProgressThrottled(batchId: String) {
        let now = Date().timeIntervalSince1970
        if now - lastEmitTime < 0.250 { return } // Max 4Hz throttle
        lastEmitTime = now
        
        if let status = db.getBatchStatus(batchId: batchId) {
            onProgressEvent?(status)
        }
    }
}
