const fs = require('fs');

const files = [
  'src/components/accounting/BudgetPlanner.tsx',
  'src/components/reports/ProfitAndLossView.tsx'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    let code = fs.readFileSync(f, 'utf8');
    const regex = /const formatCurrency = \(cents: number\) => {\s*return formatCurrency\(cents \);\s*};\s*/g;
    code = code.replace(regex, '');
    fs.writeFileSync(f, code);
  }
});
console.log("Fixed recursion");
