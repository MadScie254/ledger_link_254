const fs = require('fs');
let text = fs.readFileSync('src/components/sales/SalesView.tsx', 'utf8');

if (!text.includes('ConfirmModal')) {
  text = text.replace("import { Download, Trash, Tag } from 'lucide-react';", "import { Download, Trash, Tag } from 'lucide-react';\nimport { ConfirmModal } from '../layout/ConfirmModal';");
}

const stateRegex = /const \[selectedIds, setSelectedIds\] = useState<string\[\]>\(\[\]\);/;
const replacementState = `const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'delete' | 'categorize' | null>(null);

  const handleBulkAction = () => {
    if (confirmAction === 'delete') {
      console.log('Deleting', selectedIds);
      // Actual deletion logic would go here
    } else if (confirmAction === 'categorize') {
      console.log('Categorizing', selectedIds);
    }
    setConfirmOpen(false);
    setSelectedIds([]);
  };`;
text = text.replace(stateRegex, replacementState);

const fabRegex = /<button className="flex items-center text-sm font-medium hover:text-focus-blue-500 transition-colors">/g;
text = text.replace('<button className="flex items-center text-sm font-medium hover:text-focus-blue-500 transition-colors">', '<button onClick={() => { setConfirmAction(\'categorize\'); setConfirmOpen(true); }} className="flex items-center text-sm font-medium hover:text-focus-blue-500 transition-colors">');

text = text.replace('<button className="flex items-center text-sm font-medium hover:text-rust-700 transition-colors">', '<button onClick={() => { setConfirmAction(\'delete\'); setConfirmOpen(true); }} className="flex items-center text-sm font-medium hover:text-rust-700 transition-colors">');

const renderRegex = /(<\/div>\s*\)\;\s*\}$)/;
const modalJSX = `
      <ConfirmModal 
        isOpen={confirmOpen}
        title={confirmAction === 'delete' ? 'Delete Invoices' : 'Categorize Invoices'}
        message={confirmAction === 'delete' ? \`Are you sure you want to permanently delete \${selectedIds.length} selected invoice(s)? This cannot be undone.\` : \`Are you sure you want to bulk categorize \${selectedIds.length} invoice(s)?\`}
        confirmText={confirmAction === 'delete' ? 'Delete' : 'Categorize'}
        isDestructive={confirmAction === 'delete'}
        onConfirm={handleBulkAction}
        onCancel={() => setConfirmOpen(false)}
      />
`;
text = text.replace(renderRegex, modalJSX + "$1");

fs.writeFileSync('src/components/sales/SalesView.tsx', text);
console.log("Success Sales");
