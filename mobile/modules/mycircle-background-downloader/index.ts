import { requireNativeModule, requireOptionalNativeModule, EventEmitter } from 'expo-modules-core';

export type SourceType = 'INDIVIDUAL_PHOTO' | 'INDIVIDUAL_VIDEO' | 'ALBUM' | 'MULTIPLE_SELECTED' | 'HIGHLIGHT' | 'OTHER';
export type ExportMode = 'MYCIRCLE_ONLY' | 'DEVICE_GALLERY' | 'BOTH';

export interface DownloadTaskConfig {
  id: string;
  url: string;
  destinationPath: string;
  fileType: 'PHOTO' | 'VIDEO';
  sourceType: SourceType;
  exportMode?: ExportMode;
  expectedSizeBytes?: number;
  expectedChecksumSha256?: string;
  priority?: number;
}

export interface BatchEnqueueRequest {
  batchId: string;
  title: string;
  sourceType: SourceType;
  exportMode: ExportMode;
  tasks: DownloadTaskConfig[];
  wifiOnly?: boolean;
}

export interface BatchStatus {
  batchId: string;
  title: string;
  sourceType: SourceType;
  exportMode: ExportMode;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  status: 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
}

export interface EnqueueResult {
  success: boolean;
  isDuplicate: boolean;
  batchId: string;
}

const NativeModule = requireOptionalNativeModule('MyCircleBackgroundDownloader') || {
  getBatchStatusSync: () => null,
  getAllBatchesSync: () => [],
  enqueueBatch: async () => ({ success: false, isDuplicate: false, batchId: '' }),
  enqueueSingleItem: async () => ({ success: false, isDuplicate: false, batchId: '' }),
  pauseBatch: async () => false,
  resumeBatch: async () => false,
  cancelBatch: async () => false,
  updateTaskUrl: async () => false,
  clearQueue: async () => false,
  addListener: () => ({ remove: () => {} }),
  removeListeners: () => {},
};

const emitter = new EventEmitter(NativeModule as any);

export function getBatchStatusSync(batchId: string): BatchStatus | null {
  return NativeModule.getBatchStatusSync(batchId);
}

export function getAllBatchesSync(): BatchStatus[] {
  return NativeModule.getAllBatchesSync() || [];
}

export async function clearQueue(): Promise<boolean> {
  return await NativeModule.clearQueue();
}

export async function enqueueBatch(request: BatchEnqueueRequest & { overwrite?: boolean }): Promise<EnqueueResult> {
  return await NativeModule.enqueueBatch(request);
}

export async function enqueueSingleItem(task: DownloadTaskConfig & { overwrite?: boolean }): Promise<EnqueueResult> {
  return await NativeModule.enqueueSingleItem(task);
}


export async function pauseBatch(batchId: string): Promise<boolean> {
  return await NativeModule.pauseBatch(batchId);
}

export async function resumeBatch(batchId: string): Promise<boolean> {
  return await NativeModule.resumeBatch(batchId);
}

export async function cancelBatch(batchId: string): Promise<boolean> {
  return await NativeModule.cancelBatch(batchId);
}

export async function updateTaskUrl(taskId: string, newUrl: string): Promise<boolean> {
  return await NativeModule.updateTaskUrl(taskId, newUrl);
}

export function subscribeBatchProgress(listener: (event: BatchStatus) => void) {
  return (emitter as any).addListener('onBatchProgress', listener);
}

export function subscribeTaskCompleted(listener: (event: { taskId: string; batchId: string; localUri: string }) => void) {
  return (emitter as any).addListener('onTaskCompleted', listener);
}

export function subscribeUrlExpired(listener: (event: { taskId: string; batchId: string; statusCode: number }) => void) {
  return (emitter as any).addListener('onUrlExpired', listener);
}

