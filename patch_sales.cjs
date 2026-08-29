const fs = require('fs');
let text = fs.readFileSync('src/components/sales/SalesView.tsx', 'utf8');

// Add import
const importSearch = `import { format } from 'date-fns';`;
const importReplacement = `import { format } from 'date-fns';\nimport { RecurringInvoices } from './RecurringInvoices';`;
text = text.replace(importSearch, importReplacement);

// Add activeTab state
const stateSearch = `const [isBuilding, setIsBuilding] = useState(false);`;
const stateReplacement = `const [isBuilding, setIsBuilding] = useState(false);\n  const [activeTab, setActiveTab] = useState<'Invoices' | 'Recurring'>('Invoices');`;
text = text.replace(stateSearch, stateReplacement);

// Replace the return block for the normal view (not isBuilding)
const returnSearch = `  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Invoices</h1>
        <button 
          onClick={() => setIsBuilding(true)}
          className="bg-ink-900 text-white px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
        >
          Create Invoice
        </button>
      </div>
      <div className="ledger-divider mb-6"></div>`;

const returnReplacement = `  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Sales & Invoicing</h1>
        {activeTab === 'Invoices' && (
          <button 
            onClick={() => setIsBuilding(true)}
            className="bg-ink-900 text-white px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors"
          >
            Create Invoice
          </button>
        )}
      </div>
      
      <div className="flex space-x-6 mb-6">
        <button
          onClick={() => setActiveTab('Invoices')}
          className={\`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap \${
            activeTab === 'Invoices'
              ? 'border-brass-500 text-ink-900'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
          }\`}
        >
          One-Time Invoices
        </button>
        <button
          onClick={() => setActiveTab('Recurring')}
          className={\`pb-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap \${
            activeTab === 'Recurring'
              ? 'border-brass-500 text-ink-900'
              : 'border-transparent text-slate-500 hover:text-ink-900 hover:border-ink-900/20'
          }\`}
        >
          Recurring Invoices
        </button>
      </div>

      <div className="ledger-divider mb-6"></div>

      {activeTab === 'Recurring' ? (
        <RecurringInvoices />
      ) : (
`;

text = text.replace(returnSearch, returnReplacement);

const endSearch = `        )}
      </div>
    </div>
  );
}`;

const endReplacement = `        )}
      </div>
      )}
    </div>
  );
}`;

text = text.replace(endSearch, endReplacement);

fs.writeFileSync('src/components/sales/SalesView.tsx', text);
console.log("Success");
