import {
  enqueueBatch,
  enqueueSingleItem,
  pauseBatch,
  resumeBatch,
  cancelBatch,
  updateTaskUrl,
  getBatchStatusSync,
  getAllBatchesSync,
  subscribeBatchProgress,
  subscribeTaskCompleted,
  subscribeUrlExpired,
  BatchEnqueueRequest,
  DownloadTaskConfig,
  BatchStatus,
} from '../../../modules/mycircle-background-downloader';

export class GlobalDownloadManagerService {
  private static instance: GlobalDownloadManagerService;
  private activeSubscriptions: (() => void)[] = [];
  private onUrlExpiredHandler?: (taskId: string, batchId: string) => Promise<string | null>;

  private constructor() {
    this.initListeners();
    this.restoreStateFromSQLite();
  }

  public restoreStateFromSQLite(): BatchStatus[] {
    try {
      const allBatches = getAllBatchesSync();
      console.log(`[MyCircleDownloader] Restored ${allBatches.length} batches from native SQLite on launch.`);
      return allBatches;
    } catch (e) {
      console.error('[MyCircleDownloader] Failed to restore queue state from SQLite:', e);
      return [];
    }
  }


  public static getInstance(): GlobalDownloadManagerService {
    if (!GlobalDownloadManagerService.instance) {
      GlobalDownloadManagerService.instance = new GlobalDownloadManagerService();
    }
    return GlobalDownloadManagerService.instance;
  }

  private initListeners() {
    // 1. Listen for throttled progress events
    const subProgress = subscribeBatchProgress((event: BatchStatus) => {
      // Broadcast to active UI state managers / listeners
    });

    // 2. Listen for individual task completion
    const subComplete = subscribeTaskCompleted((event) => {
      console.log(`[MyCircleDownloader] Task completed: ${event.taskId} -> ${event.localUri}`);
    });

    // 3. Listen for signed URL expiration (HTTP 403 / 410)
    const subExpired = subscribeUrlExpired(async (event) => {
      console.warn(`[MyCircleDownloader] Signed URL expired for task ${event.taskId}. Fetching fresh URL...`);
      if (this.onUrlExpiredHandler) {
        const freshUrl = await this.onUrlExpiredHandler(event.taskId, event.batchId);
        if (freshUrl) {
          await updateTaskUrl(event.taskId, freshUrl);
          console.log(`[MyCircleDownloader] Updated task ${event.taskId} with fresh URL and resumed.`);
        }
      }
    });

    this.activeSubscriptions.push(
      () => subProgress.remove(),
      () => subComplete.remove(),
      () => subExpired.remove()
    );
  }

  public setUrlExpiredHandler(handler: (taskId: string, batchId: string) => Promise<string | null>) {
    this.onUrlExpiredHandler = handler;
  }

  public async startBatchDownload(request: BatchEnqueueRequest & { overwrite?: boolean }) {
    return await enqueueBatch(request);
  }

  public async startSingleDownload(task: DownloadTaskConfig & { overwrite?: boolean }) {
    return await enqueueSingleItem(task);
  }


  public async pause(batchId: string): Promise<boolean> {
    return await pauseBatch(batchId);
  }

  public async resume(batchId: string): Promise<boolean> {
    return await resumeBatch(batchId);
  }

  public async cancel(batchId: string): Promise<boolean> {
    return await cancelBatch(batchId);
  }

  public getBatchStatus(batchId: string): BatchStatus | null {
    return getBatchStatusSync(batchId);
  }

  public cleanup() {
    this.activeSubscriptions.forEach((unsub) => unsub());
    this.activeSubscriptions = [];
  }
}

export const downloadManager = GlobalDownloadManagerService.getInstance();
