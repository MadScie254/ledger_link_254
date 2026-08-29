export function BusinessFeedView() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-serif text-ink-900 mb-4">AI Business Feed</h1>
        <p className="text-slate-500">Your financial co-pilot. Natural language querying, anomaly detection, and insights.</p>
      </div>

      <div className="bg-paper-100 border border-ink-900/10 rounded-sm shadow-sm overflow-hidden mb-8">
        <div className="p-4 border-b border-ink-900/10 bg-paper-50 flex items-center space-x-3">
           <div className="w-8 h-8 rounded-full bg-ink-900 flex items-center justify-center text-white">✨</div>
           <input 
             type="text" 
             placeholder="Ask anything (e.g. 'Why did travel expenses spike in March?' or 'Forecast cashflow for Q3')"
             className="flex-1 bg-transparent border-none outline-none text-ink-900 placeholder:text-slate-400"
           />
           <button className="bg-ink-900 text-white  px-4 py-2 text-sm font-medium rounded-sm">Ask</button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Insight Card 1 */}
        <div className="bg-paper-100 border border-ink-900/10 rounded-sm shadow-sm p-6 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-rust-700"></div>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2 mb-2">
                <span className="bg-rust-700/10 text-rust-700 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">Anomaly Detected</span>
                <span className="text-xs text-slate-500">2 hours ago</span>
              </div>
              <h3 className="text-lg font-medium text-ink-900 mb-2">Unusual Spike in Server Expenses</h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                AWS expenses for this month (KES 125,000) are 45% higher than your historical 6-month average. 
                This was driven by a new charge labeled "RDS Provisioned IOPS".
              </p>
              <div className="space-x-3">
                <button className="text-sm font-medium text-focus-blue-500 hover:text-ink-900">View Bill</button>
                <button className="text-sm font-medium text-slate-500 hover:text-ink-900">Dismiss</button>
              </div>
            </div>
          </div>
        </div>

        {/* Insight Card 2 */}
        <div className="bg-paper-100 border border-ink-900/10 rounded-sm shadow-sm p-6 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-ledger-green-700"></div>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2 mb-2">
                <span className="bg-ledger-green-700/10 text-ledger-green-700 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider">Cashflow Forecast</span>
                <span className="text-xs text-slate-500">Yesterday</span>
              </div>
              <h3 className="text-lg font-medium text-ink-900 mb-2">Healthy Runway for Q4</h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Based on current receivable aging and scheduled payroll, you will maintain a positive cash buffer of KES 850,000 through the end of November. No short-term financing required.
              </p>
              <div className="space-x-3">
                <button className="text-sm font-medium text-focus-blue-500 hover:text-ink-900">View Cashflow Report</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
