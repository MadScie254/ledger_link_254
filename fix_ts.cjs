const fs = require('fs');

// 1. BankingView
let banking = fs.readFileSync('src/components/banking/BankingView.tsx', 'utf8');
const filterBlock = `  const rawTx = txData?.transactions || [];
  const filteredTx = rawTx.filter((tx: any) => {
    let matches = true;
    if (filterSearch && !tx.description.toLowerCase().includes(filterSearch.toLowerCase())) matches = false;
    if (filterDate && tx.date.substring(0, 10) !== filterDate) matches = false;
    if (filterDirection !== 'ALL' && tx.direction !== filterDirection) matches = false;
    return matches;
  });`;
banking = banking.replace(filterBlock, ''); // remove it from top
// put it after txData query
banking = banking.replace(
  "    queryFn: async () => {\n      const res = await fetch('/api/banking/transactions', {\n        headers: { 'x-org-id': currentOrgId },\n      });\n      if (!res.ok) throw new Error('Failed to fetch transactions');\n      return res.json();\n    }\n  });",
  "    queryFn: async () => {\n      const res = await fetch('/api/banking/transactions', {\n        headers: { 'x-org-id': currentOrgId },\n      });\n      if (!res.ok) throw new Error('Failed to fetch transactions');\n      return res.json();\n    }\n  });\n" + filterBlock
);

if (!banking.includes("import { Download")) {
  banking = banking.replace("import { Filter, Search } from 'lucide-react';", "import { Filter, Search, Download } from 'lucide-react';");
}
fs.writeFileSync('src/components/banking/BankingView.tsx', banking);

// 2. DashboardView - useRenderTracker
let dash = fs.readFileSync('src/components/dashboard/DashboardView.tsx', 'utf8');
if (!dash.includes("useRenderTracker")) {
  dash = dash.replace("import { useState, useMemo } from 'react';", "import { useState, useMemo } from 'react';\nimport { useRenderTracker } from '../../utils/monitoring';");
}
fs.writeFileSync('src/components/dashboard/DashboardView.tsx', dash);

// 3. server/bills.ts and server/invoices.ts
let bills = fs.readFileSync('src/server/bills.ts', 'utf8');
bills = bills.replace(/description:.*,/g, "");
fs.writeFileSync('src/server/bills.ts', bills);

let invoices = fs.readFileSync('src/server/invoices.ts', 'utf8');
invoices = invoices.replace(/description:.*,/g, "");
fs.writeFileSync('src/server/invoices.ts', invoices);

// 4. React imports
const files = [
  'src/components/accounting/AccountingView.tsx',
  'src/components/accounting/BudgetPlanner.tsx',
  'src/components/expenses/ReceiptScanner.tsx',
  'src/components/layout/AppLayout.tsx',
  'src/components/layout/LockScreen.tsx',
  'src/components/sales/RecurringInvoices.tsx',
  'src/components/sales/SalesView.tsx',
  'src/components/expenses/ExpensesView.tsx',
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    let code = fs.readFileSync(f, 'utf8');
    if (!code.includes("import React") && !code.includes("import * as React")) {
      code = "import React from 'react';\n" + code;
      fs.writeFileSync(f, code);
    }
  }
});

console.log("Fixed");
