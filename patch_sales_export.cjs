const fs = require('fs');
let text = fs.readFileSync('src/components/sales/SalesView.tsx', 'utf8');

// Add import Download icon
text = text.replace("import { format } from 'date-fns';", "import { format } from 'date-fns';\nimport { Download } from 'lucide-react';");

// Create export function
const exportFunc = `
  const handleExportCSV = () => {
    if (!invoicesData?.invoices) return;
    const headers = ['Date', 'Invoice No', 'Customer ID', 'Status', 'Total'];
    const rows = invoicesData.invoices.map((inv: any) => [
      format(new Date(inv.issueDate), 'yyyy-MM-dd'),
      inv.invoiceNo,
      inv.customerId,
      inv.status,
      (inv.totalCents / 100).toFixed(2)
    ]);
    const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoices.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };
`;

// Insert after activeTab state
text = text.replace("const [activeTab, setActiveTab] = useState<'Invoices' | 'Recurring'>('Invoices');", "const [activeTab, setActiveTab] = useState<'Invoices' | 'Recurring'>('Invoices');\n" + exportFunc);

// Add button next to Create Invoice
const buttonHtml = `
          <div className="flex space-x-2">
            <button 
              onClick={handleExportCSV}
              className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors flex items-center"
            >
              <Download className="h-4 w-4 mr-2" /> Export
            </button>
            <button 
              onClick={() => setIsBuilding(true)}
              className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
            >
              Create Invoice
            </button>
          </div>
`;

const oldButton = `{activeTab === 'Invoices' && (
          <button 
            onClick={() => setIsBuilding(true)}
            className="bg-ink-900 text-white dark:text-slate-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Create Invoice
          </button>
        )}`;

text = text.replace(oldButton, `{activeTab === 'Invoices' && (${buttonHtml})}`);

fs.writeFileSync('src/components/sales/SalesView.tsx', text);
console.log("Success");
