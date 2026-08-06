package com.mycircle.downloader

import com.mycircle.downloader.db.NativeSQLiteHelper
import com.mycircle.downloader.engine.NativeDownloadEngine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MyCircleBackgroundDownloaderModule : Module() {

    override fun definition() = ModuleDefinition {

        Name("MyCircleBackgroundDownloader")

        Events("onBatchProgress", "onTaskCompleted", "onUrlExpired")

        OnCreate {
            val context = appContext.reactContext ?: return@OnCreate
            val engine = NativeDownloadEngine.getInstance(context)

            engine.onProgressEvent = { data ->
                sendEvent("onBatchProgress", data)
            }
            engine.onTaskCompletedEvent = { data ->
                sendEvent("onTaskCompleted", data)
            }
            engine.onUrlExpiredEvent = { data ->
                sendEvent("onUrlExpired", data)
            }
        }

        Function("getBatchStatusSync") { batchId: String ->
            val context = appContext.reactContext ?: return@Function null
            NativeSQLiteHelper.getInstance(context).getBatchStatus(batchId)
        }

        Function("getAllBatchesSync") {
            val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any?>>()
            NativeSQLiteHelper.getInstance(context).getAllBatches()
        }

        AsyncFunction("clearQueue") {
            val context = appContext.reactContext ?: return@AsyncFunction false
            NativeSQLiteHelper.getInstance(context).clearQueue()
            true
        }

        AsyncFunction("enqueueBatch") { request: Map<String, Any?> ->
            val context = appContext.reactContext ?: return@AsyncFunction mapOf("success" to false, "isDuplicate" to false, "batchId" to "")
            val batchId = request["batchId"] as? String ?: return@AsyncFunction mapOf("success" to false, "isDuplicate" to false, "batchId" to "")
            val title = request["title"] as? String ?: return@AsyncFunction mapOf("success" to false, "isDuplicate" to false, "batchId" to "")
            val sourceType = request["sourceType"] as? String ?: return@AsyncFunction mapOf("success" to false, "isDuplicate" to false, "batchId" to "")
            val exportMode = request["exportMode"] as? String ?: return@AsyncFunction mapOf("success" to false, "isDuplicate" to false, "batchId" to "")
            val overwrite = (request["overwrite"] as? Boolean) ?: false
            @Suppress("UNCHECKED_CAST")
            val tasks = request["tasks"] as? List<Map<String, Any?>> ?: return@AsyncFunction mapOf("success" to false, "isDuplicate" to false, "batchId" to "")

            val db = NativeSQLiteHelper.getInstance(context)
            val result = db.enqueueBatch(batchId, title, sourceType, exportMode, tasks, overwrite)

            val isDup = (result["isDuplicate"] as? Boolean) ?: false
            val success = (result["success"] as? Boolean) ?: false

            if (success && !isDup) {
                val targetBatchId = (result["batchId"] as? String) ?: batchId
                val engine = NativeDownloadEngine.getInstance(context)
                val pendingTasks = db.getPendingTasksForBatch(targetBatchId)
                for (task in pendingTasks) {
                    engine.downloadItem(task.id, targetBatchId, task.url, task.destinationPath, task.expectedSizeBytes)
                }
            }

            result
        }


        AsyncFunction("enqueueSingleItem") { task: Map<String, Any?> ->
            val context = appContext.reactContext ?: return@AsyncFunction false
            val taskId = task["id"] as? String ?: return@AsyncFunction false
            val url = task["url"] as? String ?: return@AsyncFunction false
            val destPath = task["destinationPath"] as? String ?: return@AsyncFunction false
            val sourceType = task["sourceType"] as? String ?: return@AsyncFunction false

            val pathClean = destPath.lowercase().replace("/", "_").replace(".", "_")
            val batchId = "single_$pathClean"
            val exportMode = (task["exportMode"] as? String) ?: "MYCIRCLE_ONLY"
            val overwrite = (task["overwrite"] as? Boolean) ?: false

            val db = NativeSQLiteHelper.getInstance(context)
            val result = db.enqueueBatch(batchId, "Single Photo ($destPath)", sourceType, exportMode, listOf(task), overwrite)

            val isDup = (result["isDuplicate"] as? Boolean) ?: false
            val success = (result["success"] as? Boolean) ?: false

            if (success && !isDup) {
                val targetBatchId = (result["batchId"] as? String) ?: batchId
                val engine = NativeDownloadEngine.getInstance(context)
                val pendingTasks = db.getPendingTasksForBatch(targetBatchId)
                for (pending in pendingTasks) {
                    engine.downloadItem(pending.id, targetBatchId, pending.url, pending.destinationPath, pending.expectedSizeBytes)
                }
            }

            result
        }



        AsyncFunction("pauseBatch") { batchId: String ->
            val context = appContext.reactContext ?: return@AsyncFunction false
            NativeDownloadEngine.getInstance(context).pauseBatch(batchId)
            true
        }

        AsyncFunction("resumeBatch") { batchId: String ->
            val context = appContext.reactContext ?: return@AsyncFunction false
            NativeDownloadEngine.getInstance(context).resumeBatch(batchId)
            true
        }

        AsyncFunction("cancelBatch") { batchId: String ->
            val context = appContext.reactContext ?: return@AsyncFunction false
            NativeDownloadEngine.getInstance(context).cancelBatch(batchId)
            true
        }


        AsyncFunction("updateTaskUrl") { taskId: String, newUrl: String ->
            val context = appContext.reactContext ?: return@AsyncFunction false
            NativeSQLiteHelper.getInstance(context).updateTaskUrl(taskId, newUrl)
        }
    }
}
