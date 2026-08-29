const fs = require('fs');
let text = fs.readFileSync('src/components/layout/CommandPalette.tsx', 'utf8');

const searchOptions = `
  const options = [
    { name: 'Customer Hub (Clients)', view: 'Customer Hub', type: 'View' },
    { name: 'Sales (Invoices)', view: 'Sales', type: 'View' },
    { name: 'Accounting (Journal Entries)', view: 'Accounting', type: 'View' },
    { name: 'Banking', view: 'Banking', type: 'View' },
    { name: 'Reports', view: 'Reports', type: 'View' },
    { name: 'Expenses & Bills', view: 'Expenses & Bills', type: 'View' },
    { name: 'Settings', view: 'Settings', type: 'View' }, // Added Settings
    { name: 'INV-1045 - ACME Corp', view: 'Sales', type: 'Transaction' },
    { name: 'INV-1046 - Globex', view: 'Sales', type: 'Transaction' },
    { name: 'Payment - Equity Bank', view: 'Banking', type: 'Transaction' },
    { name: 'Customer: ACME Corp', view: 'Customer Hub', type: 'Customer' },
    { name: 'Customer: Globex', view: 'Customer Hub', type: 'Customer' },
    { name: 'App Settings - General', view: 'Settings', type: 'Setting' },
    { name: 'App Settings - Users', view: 'Settings', type: 'Setting' },
  ];
`;

text = text.replace(/const options = \[[\s\S]*?\];/, searchOptions);

const listRender = `
            filteredOptions.map((option) => (
              <li
                key={option.name}
                className="px-4 py-2 hover:bg-focus-blue-500 hover:text-white dark:hover:text-[#0B0F19] cursor-pointer transition-colors flex justify-between items-center"
                onClick={() => handleSelect(option.view)}
              >
                <span>{option.name}</span>
                <span className="text-xs opacity-60">{option.type}</span>
              </li>
            ))
`;

text = text.replace(/filteredOptions\.map\(\(option\) => \([\s\S]*?<\/li>\s*\)\)/, listRender);

fs.writeFileSync('src/components/layout/CommandPalette.tsx', text);
console.log("Success");
