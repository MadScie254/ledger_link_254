const fs = require('fs');
let text = fs.readFileSync('src/components/expenses/ExpensesView.tsx', 'utf8');

// Add Trash icon to imports if not there
if (!text.includes('Trash')) {
  text = text.replace("import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';", "import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';\nimport { Trash, Tag } from 'lucide-react';");
}

// Add state for selectedIds
const stateSearch = "const [activeTab, setActiveTab] = useState<'Bills' | 'Vendors' | 'Bill payments'>('Bills');";
const stateReplacement = "const [activeTab, setActiveTab] = useState<'Bills' | 'Vendors' | 'Bill payments'>('Bills');\n  const [selectedIds, setSelectedIds] = useState<string[]>([]);\n  \n  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {\n    if (e.target.checked && billsData?.bills) {\n      setSelectedIds(billsData.bills.map((b: any) => b.id));\n    } else {\n      setSelectedIds([]);\n    }\n  };\n\n  const handleSelectOne = (id: string) => {\n    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);\n  };\n";
text = text.replace(stateSearch, stateReplacement);

// Floating Action Bar JSX
const floatingActionBar = `
      {selectedIds.length > 0 && activeTab === 'Bills' && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-ink-900 text-white dark:bg-[#111827] dark:border dark:border-ink-900/20 px-6 py-3 rounded-full shadow-2xl flex items-center space-x-6 z-50">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="h-4 w-px bg-white/20"></div>
          <button className="flex items-center text-sm font-medium hover:text-focus-blue-500 transition-colors">
            <Tag className="w-4 h-4 mr-2" /> Categorize
          </button>
          <button className="flex items-center text-sm font-medium hover:text-rust-700 transition-colors">
            <Trash className="w-4 h-4 mr-2" /> Delete
          </button>
        </div>
      )}
`;

// Insert floating action bar before the final return closing div
const returnEndRegex = /(<\/div>\s*\)\;\s*\}$)/;
text = text.replace(returnEndRegex, floatingActionBar + "\n$1");

// Add Checkbox to TH for Bills
const thRegex = /<tr>\s*<th className="px-4 py-3 font-semibold">Date<\/th>/;
const thReplacement = `<tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" className="rounded border-ink-900/20 text-focus-blue-500 focus:ring-focus-blue-500" onChange={handleSelectAll} checked={selectedIds.length > 0 && billsData?.bills?.length === selectedIds.length} />
                </th>
                <th className="px-4 py-3 font-semibold">Date</th>`;
text = text.replace(thRegex, thReplacement);

// Add Checkbox to TD for Bills
const tdRegex = /<tr key=\{bill\.id\} className="hover:bg-paper-50 transition-colors">/g;
const tdReplacement = `<tr key={bill.id} className="hover:bg-paper-50 transition-colors">
                  <td className="px-4 py-3 w-8">
                    <input type="checkbox" className="rounded border-ink-900/20 text-focus-blue-500 focus:ring-focus-blue-500" checked={selectedIds.includes(bill.id)} onChange={() => handleSelectOne(bill.id)} />
                  </td>`;
text = text.replace(tdRegex, tdReplacement);

fs.writeFileSync('src/components/expenses/ExpensesView.tsx', text);
console.log("Success");
