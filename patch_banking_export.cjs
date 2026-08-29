const fs = require('fs');
let text = fs.readFileSync('src/components/banking/BankingView.tsx', 'utf8');

// Add import Download icon
if (!text.includes('Download')) {
  text = text.replace("import { CheckCircle2, AlertCircle } from 'lucide-react';", "import { CheckCircle2, AlertCircle, Download } from 'lucide-react';");
}

// Create export function
const exportFunc = `
  const handleExportCSV = () => {
    if (!transactions.length) return;
    const headers = ['Date', 'Description', 'Direction', 'Amount', 'Status'];
    const rows = transactions.map((tx: any) => [
      format(new Date(tx.date), 'yyyy-MM-dd'),
      \`"\${tx.description.replace(/"/g, '""')}"\`,
      tx.direction,
      (tx.amountCents / 100).toFixed(2),
      tx.status
    ]);
    const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transactions.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };
`;

text = text.replace("const transactions = txData?.transactions || [];", exportFunc + "\n  const transactions = txData?.transactions || [];");

// Modify header to include export button
const headerSearch = `      <div className="mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Banking</h1>
      </div>`;

const headerReplacement = `      <div className="mb-2 flex justify-between items-center">
        <h1 className="text-2xl font-serif text-ink-900">Banking</h1>
        <button 
          onClick={handleExportCSV}
          className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors flex items-center"
        >
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </button>
      </div>`;

text = text.replace(headerSearch, headerReplacement);

fs.writeFileSync('src/components/banking/BankingView.tsx', text);
console.log("Success");
