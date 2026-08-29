const fs = require('fs');
let text = fs.readFileSync('src/components/expenses/ExpensesView.tsx', 'utf8');

// Add import
const importSearch = `import { format } from 'date-fns';`;
const importReplacement = `import { format } from 'date-fns';\nimport { ReceiptScanner } from './ReceiptScanner';`;
text = text.replace(importSearch, importReplacement);

// Add state
const stateSearch = `  const [isCreatingBill, setIsCreatingBill] = useState(false);`;
const stateReplacement = `  const [isCreatingBill, setIsCreatingBill] = useState(false);\n  const [isScanningReceipt, setIsScanningReceipt] = useState(false);\n  const [scannedData, setScannedData] = useState<{ vendor: string; amount: number; date: string } | null>(null);`;
text = text.replace(stateSearch, stateReplacement);

// Add scan button in action bar
const buttonSearch = `<button onClick={() => setIsCreatingBill(true)} className="bg-ink-900 text-white px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">            Record Bill          </button>`;
const buttonReplacement = `<button onClick={() => setIsScanningReceipt(true)} className="bg-white border border-ink-900/20 text-ink-900 px-4 py-2 text-sm font-medium rounded-sm hover:bg-paper-50 transition-colors mr-2">            Scan Receipt          </button>          <button onClick={() => setIsCreatingBill(true)} className="bg-ink-900 text-white px-4 py-2 text-sm font-medium rounded-sm hover:bg-ink-900/90 transition-colors">            Record Bill          </button>`;
text = text.replace(buttonSearch, buttonReplacement);

// Add scanner modal logic at the bottom
const endSearch = `    </div>  );}`;
const endReplacement = `      {isScanningReceipt && (
        <ReceiptScanner
          onClose={() => setIsScanningReceipt(false)}
          onScanComplete={(data) => {
            setScannedData(data);
            setIsScanningReceipt(false);
            setIsCreatingBill(true);
          }}
        />
      )}
    </div>
  );
}`;
text = text.replace(endSearch, endReplacement);

fs.writeFileSync('src/components/expenses/ExpensesView.tsx', text);
console.log("Success");
