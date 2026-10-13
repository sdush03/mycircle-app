import { create } from 'zustand';

export interface CrashReport {
  message: string;
  stack?: string;
  componentStack?: string;
  isFatal?: boolean;
  source: string;
  timestamp: number;
}

interface DebugCrashState {
  activeCrash: CrashReport | null;
  crashHistory: CrashReport[];
  showCrashModal: boolean;
  reportCrash: (error: any, source?: string, isFatal?: boolean, componentStack?: string) => void;
  clearActiveCrash: () => void;
  clearHistory: () => void;
  setShowCrashModal: (show: boolean) => void;
}

export const useDebugCrashStore = create<DebugCrashState>((set, get) => ({
  activeCrash: null,
  crashHistory: [],
  showCrashModal: false,

  reportCrash: (error: any, source = 'GLOBAL', isFatal = false, componentStack?: string) => {
    // In production, debug crash reporting is completely disabled
    if (!__DEV__) {
      return;
    }

    let message = 'Unknown error';
    let stack: string | undefined;

    if (typeof error === 'string') {
      message = error;
    } else if (error && typeof error === 'object') {
      message = error.message || error.name || JSON.stringify(error);
      stack = error.stack;
    }

    const report: CrashReport = {
      message,
      stack,
      componentStack,
      isFatal,
      source,
      timestamp: Date.now(),
    };

    console.error(`[DEBUG CRASH 💥] [${source}] ${isFatal ? 'FATAL' : 'NON-FATAL'}: ${message}`);
    if (stack) {
      console.error(stack);
    }

    set((state) => ({
      activeCrash: report,
      showCrashModal: true,
      crashHistory: [report, ...state.crashHistory].slice(0, 10),
    }));
  },

  clearActiveCrash: () => set({ activeCrash: null, showCrashModal: false }),
  clearHistory: () => set({ crashHistory: [], activeCrash: null, showCrashModal: false }),
  setShowCrashModal: (show: boolean) => set({ showCrashModal: __DEV__ ? show : false }),
}));
