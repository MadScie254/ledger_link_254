import { create } from 'zustand';
import { useEffect } from 'react';

interface ApiMetric {
  url: string;
  duration: number;
  status: number;
  timestamp: number;
}

interface RenderMetric {
  component: string;
  duration: number;
  timestamp: number;
}

interface MonitoringState {
  apiMetrics: ApiMetric[];
  renderMetrics: RenderMetric[];
  recordApiCall: (url: string, duration: number, status: number) => void;
  recordRender: (component: string, duration: number) => void;
  clearMetrics: () => void;
}

export const useMonitoringStore = create<MonitoringState>((set) => ({
  apiMetrics: [],
  renderMetrics: [],
  recordApiCall: (url, duration, status) => set(s => ({ 
    apiMetrics: [{url, duration, status, timestamp: Date.now()}, ...s.apiMetrics].slice(0, 100) 
  })),
  recordRender: (component, duration) => set(s => ({ 
    renderMetrics: [{component, duration, timestamp: Date.now()}, ...s.renderMetrics].slice(0, 100) 
  })),
  clearMetrics: () => set({ apiMetrics: [], renderMetrics: [] })
}));

export function useRenderTracker(componentName: string) {
  useEffect(() => {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      // Use setTimeout to avoid updating state during unmount/render cycle
      setTimeout(() => {
        useMonitoringStore.getState().recordRender(componentName, duration);
      }, 0);
    };
  });
}
