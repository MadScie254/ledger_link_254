const fs = require('fs');
let text = fs.readFileSync('src/components/expenses/ExpensesView.tsx', 'utf8');

// Update cancel button
const cancelSearch = `<button type="button" onClick={() => setIsCreatingBill(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900">Cancel</button>`;
const cancelReplacement = `<button type="button" onClick={() => { setIsCreatingBill(false); setScannedData(null); }} className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-ink-900">Cancel</button>`;
text = text.replace(cancelSearch, cancelReplacement);

// Check if we can prefill inputs
// Since inputs are uncontrolled, we can just use defaultValue with scannedData
text = text.replace(`defaultValue={format(new Date(), 'yyyy-MM-dd')}`, `defaultValue={scannedData?.date || format(new Date(), 'yyyy-MM-dd')}`);
text = text.replace(`placeholder="0.00" className`, `defaultValue={scannedData?.amount || ''} placeholder="0.00" className`);
text = text.replace(`placeholder="What was this for?"`, `defaultValue={scannedData?.vendor ? \`Receipt from \${scannedData.vendor}\` : ''} placeholder="What was this for?"`);

fs.writeFileSync('src/components/expenses/ExpensesView.tsx', text);
console.log("Success");
