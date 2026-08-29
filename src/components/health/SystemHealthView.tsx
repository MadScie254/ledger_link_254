import { useMonitoringStore } from '../../utils/monitoring';
import { format } from 'date-fns';
import { Activity, Clock, Server } from 'lucide-react';

export function SystemHealthView() {
  const { apiMetrics, renderMetrics, clearMetrics } = useMonitoringStore();

  const avgApiLatency = apiMetrics.length > 0 
    ? apiMetrics.reduce((sum, m) => sum + m.duration, 0) / apiMetrics.length 
    : 0;

  const avgRenderTime = renderMetrics.length > 0
    ? renderMetrics.reduce((sum, m) => sum + m.duration, 0) / renderMetrics.length
    : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">System Health</h1>
        <button 
          onClick={clearMetrics}
          className="bg-paper-100 border border-ink-900/20 text-ink-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors"
        >
          Clear Logs
        </button>
      </div>
      <div className="ledger-divider mb-6"></div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-paper-100 border border-ink-900/10 p-6 rounded-sm shadow-sm flex flex-col justify-between">
          <div className="flex items-center space-x-3 mb-2">
            <Server className="w-5 h-5 text-focus-blue-500" />
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Avg API Latency</h3>
          </div>
          <p className="text-3xl font-serif text-ink-900 tabular-currency">
            {avgApiLatency.toFixed(2)} ms
          </p>
        </div>

        <div className="bg-paper-100 border border-ink-900/10 p-6 rounded-sm shadow-sm flex flex-col justify-between">
          <div className="flex items-center space-x-3 mb-2">
            <Activity className="w-5 h-5 text-focus-blue-500" />
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Avg Render Time</h3>
          </div>
          <p className="text-3xl font-serif text-ink-900 tabular-currency">
            {avgRenderTime.toFixed(2)} ms
          </p>
        </div>

        <div className="bg-paper-100 border border-ink-900/10 p-6 rounded-sm shadow-sm flex flex-col justify-between">
          <div className="flex items-center space-x-3 mb-2">
            <Clock className="w-5 h-5 text-focus-blue-500" />
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Traces</h3>
          </div>
          <p className="text-3xl font-serif text-ink-900 tabular-currency">
            {apiMetrics.length + renderMetrics.length}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-paper-100 border border-ink-900/10 rounded-sm shadow-sm overflow-hidden">
          <h3 className="text-lg font-medium text-ink-900 p-6 border-b border-ink-900/10">Recent API Calls</h3>
          <ul className="divide-y divide-ink-900/5 max-h-96 overflow-y-auto">
            {apiMetrics.length === 0 ? (
              <li className="p-6 text-center text-slate-500 text-sm">No API calls recorded.</li>
            ) : apiMetrics.map((m, i) => (
              <li key={i} className="p-4 flex justify-between items-center hover:bg-paper-50 transition-colors">
                <div className="overflow-hidden">
                  <p className="text-sm font-medium text-ink-900 truncate">{m.url}</p>
                  <p className="text-xs text-slate-500">{format(new Date(m.timestamp), 'HH:mm:ss.SSS')}</p>
                </div>
                <div className="text-right pl-4">
                  <p className={`text-sm font-medium tabular-currency ${m.status >= 400 ? 'text-rust-700' : 'text-ledger-green-700'}`}>
                    {m.status}
                  </p>
                  <p className="text-xs font-medium text-slate-600 tabular-currency">{m.duration.toFixed(1)} ms</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-paper-100 border border-ink-900/10 rounded-sm shadow-sm overflow-hidden">
          <h3 className="text-lg font-medium text-ink-900 p-6 border-b border-ink-900/10">Component Renders</h3>
          <ul className="divide-y divide-ink-900/5 max-h-96 overflow-y-auto">
            {renderMetrics.length === 0 ? (
              <li className="p-6 text-center text-slate-500 text-sm">No renders recorded.</li>
            ) : renderMetrics.map((m, i) => (
              <li key={i} className="p-4 flex justify-between items-center hover:bg-paper-50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-ink-900">{m.component}</p>
                  <p className="text-xs text-slate-500">{format(new Date(m.timestamp), 'HH:mm:ss.SSS')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-600 tabular-currency">{m.duration.toFixed(1)} ms</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
