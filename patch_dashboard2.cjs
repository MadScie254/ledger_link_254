const fs = require('fs');
let text = fs.readFileSync('src/components/dashboard/DashboardView.tsx', 'utf8');

const regex = /\{\/\* Financial Overview Trend \*\/\}[\s\S]*/;

const replacement = `{/* Financial Overview Trend */}
            <div className="bg-white dark:bg-[#111827] border border-ink-900/10 rounded-sm shadow-sm p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-medium text-ink-900">Financial Overview</h3>
              </div>
              <div className="h-64 w-full">
                {data?.monthlyTrends && data.monthlyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.monthlyTrends} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} tickFormatter={(value) => \`\${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}\`} />
                      <Tooltip 
                        cursor={{fill: '#F1F5F9', opacity: 0.4}}
                        contentStyle={{ backgroundColor: '#111827', color: '#fff', borderRadius: '4px', border: 'none' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value) => [\`KES \${Number(value).toLocaleString()}\`, '']}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="revenue" name="Revenue" fill="#15803D" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="expense" name="Expenses" fill="#B91C1C" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                    No trend data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}`;

text = text.replace(regex, replacement);
fs.writeFileSync('src/components/dashboard/DashboardView.tsx', text);
console.log("Success");
