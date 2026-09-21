import { format } from 'date-fns';
import { useMonitoringStore } from '../../utils/monitoring';
import { PageHeading, EmptyNote, buttonClass } from '../ledger/Page';

export function SystemHealthView() {
  const { apiMetrics, renderMetrics, clearMetrics } = useMonitoringStore();

  const average = (values: { duration: number }[]) => (values.length ? values.reduce((sum, m) => sum + m.duration, 0) / values.length : 0);
  const failed = apiMetrics.filter((m) => m.status >= 400).length;

  const figures = [
    { label: 'Average API response', value: `${average(apiMetrics).toFixed(0)} ms`, note: `${apiMetrics.length} calls recorded` },
    { label: 'Average render', value: `${average(renderMetrics).toFixed(1)} ms`, note: `${renderMetrics.length} renders recorded` },
    { label: 'Failed calls', value: String(failed), note: failed ? 'Status 400 or above' : 'None this session', bad: failed > 0 },
  ];

  return (
    <div className="space-y-5 pb-16">
      <PageHeading
        title="System health"
        note="Measured in this browser for this session only. Nothing here is sent anywhere."
        actions={
          <button type="button" onClick={clearMetrics} className={buttonClass.secondary}>
            Clear measurements
          </button>
        }
      />

      <div className="grid grid-cols-1 border-b border-feint-strong sm:grid-cols-3">
        {figures.map((f, i) => (
          <div key={f.label} className={`px-3 py-4 sm:px-4 border-feint-strong ${i > 0 ? 'border-t sm:border-t-0 sm:border-l' : ''}`}>
            <h2 className="ll-printed text-[11.5px] text-graphite-600">{f.label}</h2>
            <p className={`mt-2 ll-figure text-[26px] leading-none ${f.bad ? 'text-ledger-red' : 'text-ink-900'}`}>{f.value}</p>
            <p className="mt-2 text-[12.5px] text-graphite-600">{f.note}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="api-calls">
          <h2 id="api-calls" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">API calls</h2>
          {apiMetrics.length === 0 ? (
            <EmptyNote>No calls recorded yet.</EmptyNote>
          ) : (
            <ol className="max-h-96 overflow-y-auto">
              {apiMetrics.map((m, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 border-b border-feint py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] text-ink-900">{m.url}</p>
                    <p className="ll-figure text-[12px] text-graphite-600">{format(new Date(m.timestamp), 'HH:mm:ss')}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`ll-figure text-[13.5px] ${m.status >= 400 ? 'font-semibold text-ledger-red' : 'text-ink-900'}`}>{m.status}</p>
                    <p className="ll-figure text-[12px] text-graphite-600">{m.duration.toFixed(0)} ms</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="renders">
          <h2 id="renders" className="ll-heading border-b-2 border-ink-900 pb-1.5 text-[20px] text-ink-900">Renders</h2>
          {renderMetrics.length === 0 ? (
            <EmptyNote>No renders recorded yet.</EmptyNote>
          ) : (
            <ol className="max-h-96 overflow-y-auto">
              {renderMetrics.map((m, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 border-b border-feint py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] text-ink-900">{m.component}</p>
                    <p className="ll-figure text-[12px] text-graphite-600">{format(new Date(m.timestamp), 'HH:mm:ss')}</p>
                  </div>
                  <p className="shrink-0 ll-figure text-[13.5px] text-ink-900">{m.duration.toFixed(1)} ms</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
