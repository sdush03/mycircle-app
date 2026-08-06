import ExpoModulesCore

public class MyCircleBackgroundDownloaderModule: Module {
    public func definition() -> ModuleDefinition {
        Name("MyCircleBackgroundDownloader")

        Events("onBatchProgress", "onTaskCompleted", "onUrlExpired")

        OnCreate {
            NativeDownloadEngine.shared.onProgressEvent = { [weak self] data in
                self?.sendEvent("onBatchProgress", data)
            }
            NativeDownloadEngine.shared.onTaskCompletedEvent = { [weak self] data in
                self?.sendEvent("onTaskCompleted", data)
            }
            NativeDownloadEngine.shared.onUrlExpiredEvent = { [weak self] data in
                self?.sendEvent("onUrlExpired", data)
            }
        }

        Function("getBatchStatusSync") { (batchId: String) -> [String: Any]? in
            return NativeQueueDatabase.shared.getBatchStatus(batchId: batchId)
        }

        Function("getAllBatchesSync") { () -> [[String: Any]] in
            return NativeQueueDatabase.shared.getAllBatches()
        }

        AsyncFunction("clearQueue") { () -> Bool in
            NativeQueueDatabase.shared.clearQueue()
            return true
        }

        AsyncFunction("enqueueBatch") { (request: [String: Any]) -> [String: Any] in
            guard let batchId = request["batchId"] as? String,
                  let title = request["title"] as? String,
                  let sourceType = request["sourceType"] as? String,
                  let exportMode = request["exportMode"] as? String,
                  let tasks = request["tasks"] as? [[String: Any]] else {
                return ["success": false, "isDuplicate": false, "batchId": ""]
            }

            let overwrite = (request["overwrite"] as? Bool) ?? false

            let result = NativeQueueDatabase.shared.enqueueBatch(
                batchId: batchId,
                title: title,
                sourceType: sourceType,
                exportMode: exportMode,
                tasks: tasks,
                overwrite: overwrite
            )

            let isDup = (result["isDuplicate"] as? Bool) ?? false
            let success = (result["success"] as? Bool) ?? false

            if success && !isDup {
                let targetBatchId = (result["batchId"] as? String) ?? batchId
                let pendingTasks = NativeQueueDatabase.shared.getPendingTasksForBatch(batchId: targetBatchId)
                for pending in pendingTasks {
                    NativeDownloadEngine.shared.downloadItem(
                        taskId: pending.id,
                        batchId: targetBatchId,
                        urlString: pending.url,
                        destinationRelativePath: pending.destinationPath,
                        expectedSizeBytes: pending.expectedSizeBytes
                    )
                }
            }

            return result
        }

        AsyncFunction("enqueueSingleItem") { (task: [String: Any]) -> [String: Any] in
            guard let taskId = task["id"] as? String,
                  let url = task["url"] as? String,
                  let destPath = task["destinationPath"] as? String,
                  let fileType = task["fileType"] as? String,
                  let sourceType = task["sourceType"] as? String else {
                return ["success": false, "isDuplicate": false, "batchId": ""]
            }

            let pathClean = destPath.lowercased().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ".", with: "_")
            let batchId = "single_\(pathClean)"
            let exportMode = (task["exportMode"] as? String) ?? "MYCIRCLE_ONLY"
            let overwrite = (task["overwrite"] as? Bool) ?? false

            let result = NativeQueueDatabase.shared.enqueueBatch(
                batchId: batchId,
                title: "Single Photo (\(destPath))",
                sourceType: sourceType,
                exportMode: exportMode,
                tasks: [task],
                overwrite: overwrite
            )


            let isDup = (result["isDuplicate"] as? Bool) ?? false
            let success = (result["success"] as? Bool) ?? false

            if success && !isDup {
                let targetBatchId = (result["batchId"] as? String) ?? batchId
                let pendingTasks = NativeQueueDatabase.shared.getPendingTasksForBatch(batchId: targetBatchId)
                for pending in pendingTasks {
                    NativeDownloadEngine.shared.downloadItem(
                        taskId: pending.id,
                        batchId: targetBatchId,
                        urlString: pending.url,
                        destinationRelativePath: pending.destinationPath,
                        expectedSizeBytes: pending.expectedSizeBytes
                    )
                }
            }

            return result
        }



        AsyncFunction("pauseBatch") { (batchId: String) -> Bool in
            NativeDownloadEngine.shared.pauseBatch(batchId: batchId)
            return true
        }

        AsyncFunction("resumeBatch") { (batchId: String) -> Bool in
            NativeDownloadEngine.shared.resumeBatch(batchId: batchId)
            return true
        }

        AsyncFunction("cancelBatch") { (batchId: String) -> Bool in
            NativeDownloadEngine.shared.cancelBatch(batchId: batchId)
            return true
        }


        AsyncFunction("updateTaskUrl") { (taskId: String, newUrl: String) -> Bool in
            return NativeQueueDatabase.shared.updateTaskUrl(taskId: taskId, newUrl: newUrl)
        }
    }
}
