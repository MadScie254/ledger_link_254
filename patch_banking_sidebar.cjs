const fs = require('fs');
let text = fs.readFileSync('src/components/banking/BankingView.tsx', 'utf8');

if (!text.includes('FilterSidebar')) {
  text = text.replace("import { format } from 'date-fns';", "import { format } from 'date-fns';\nimport { Filter, Search } from 'lucide-react';");

  const stateRegex = /const \[activeTab, setActiveTab\] = useState\('Bank transactions'\);/;
  const replacementState = `const [activeTab, setActiveTab] = useState('Bank transactions');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterDirection, setFilterDirection] = useState('ALL');`;
  text = text.replace(stateRegex, replacementState);

  const txFilterRegex = /const allJournals = journalsData\?.journals \|\| \[\];/;
  const replacementTxFilter = `const allJournals = journalsData?.journals || [];

  const rawTx = txData?.transactions || [];
  const filteredTx = rawTx.filter((tx: any) => {
    let matches = true;
    if (filterSearch && !tx.description.toLowerCase().includes(filterSearch.toLowerCase())) matches = false;
    if (filterDate && tx.date.substring(0, 10) !== filterDate) matches = false;
    if (filterDirection !== 'ALL' && tx.direction !== filterDirection) matches = false;
    return matches;
  });`;
  
  if (text.includes('const allJournals = journalsData?.journals || [];')) {
      text = text.replace(txFilterRegex, replacementTxFilter);
  } else {
      // fallback
      text = text.replace("const queryClient = useQueryClient();", "const queryClient = useQueryClient();\n" + replacementTxFilter.replace("const allJournals = journalsData?.journals || [];", ""));
  }

  // Update table mapping to use filteredTx instead of txData?.transactions
  text = text.replace(/txData\?.transactions\?.map/g, "filteredTx.map");
  text = text.replace(/txData\.transactions\.map/g, "filteredTx.map");
  
  // Add filter button and sidebar to the 'Bank transactions' tab
  const tabHeaderRegex = /<h3 className="text-sm font-bold text-ink-900 uppercase tracking-wider mb-4 border-b border-ink-900\/10 pb-2">\s*Unreviewed\s*<\/h3>/;
  const replacementTabHeader = `
          <div className="flex justify-between items-center mb-4 border-b border-ink-900/10 pb-2">
            <h3 className="text-sm font-bold text-ink-900 uppercase tracking-wider">
              Unreviewed
            </h3>
            <button onClick={() => setIsFilterOpen(!isFilterOpen)} className="flex items-center text-sm font-medium text-slate-500 hover:text-ink-900 transition-colors">
              <Filter className="w-4 h-4 mr-2" /> Filters
            </button>
          </div>
          
          <div className="flex gap-6 relative">
            <div className="flex-1 min-w-0">
  `;
  text = text.replace(tabHeaderRegex, replacementTabHeader);

  // Close the divs after the table
  const tableEndRegex = /<\/table>\s*<\/div>\s*<\/div>\s*\)\}/;
  const replacementTableEnd = `</table>
            </div>
            </div>
            {isFilterOpen && (
              <div className="w-72 bg-paper-50 border border-ink-900/10 rounded-sm p-4 shrink-0 shadow-sm h-fit sticky top-4">
                <h4 className="text-sm font-bold text-ink-900 uppercase tracking-wider mb-4">Filters</h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Search Vendor/Desc</label>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        value={filterSearch}
                        onChange={e => setFilterSearch(e.target.value)}
                        placeholder="Search..." 
                        className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm pl-8 pr-3 py-2 outline-none focus:ring-1 focus:ring-focus-blue-500" 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Specific Date</label>
                    <input 
                      type="date" 
                      value={filterDate}
                      onChange={e => setFilterDate(e.target.value)}
                      className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 outline-none focus:ring-1 focus:ring-focus-blue-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Direction</label>
                    <select 
                      value={filterDirection}
                      onChange={e => setFilterDirection(e.target.value)}
                      className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-3 py-2 outline-none focus:ring-1 focus:ring-focus-blue-500"
                    >
                      <option value="ALL">All Transactions</option>
                      <option value="IN">Money In</option>
                      <option value="OUT">Money Out</option>
                    </select>
                  </div>
                  <button onClick={() => { setFilterSearch(''); setFilterDate(''); setFilterDirection('ALL'); }} className="w-full bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm font-medium px-3 py-2 rounded-sm hover:bg-paper-50 transition-colors">
                    Clear Filters
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}`;
  
  text = text.replace(tableEndRegex, replacementTableEnd);

  fs.writeFileSync('src/components/banking/BankingView.tsx', text);
  console.log("Success Banking Sidebar");
}
