import { useEffect, useState } from 'react';
import {
  subscribeBatchProgress,
  getBatchStatusSync,
  BatchStatus,
} from '../../../../modules/mycircle-background-downloader';

export function useBatchProgress(batchId: string | null) {
  const [status, setStatus] = useState<BatchStatus | null>(() => {
    return batchId ? getBatchStatusSync(batchId) : null;
  });

  useEffect(() => {
    if (!batchId) return;

    // Set initial state
    const initial = getBatchStatusSync(batchId);
    if (initial) setStatus(initial);

    const subscription = subscribeBatchProgress((event: BatchStatus) => {
      if (event.batchId === batchId) {
        setStatus(event);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [batchId]);

  return status;
}
