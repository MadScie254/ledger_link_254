const fs = require('fs');
let text = fs.readFileSync('src/components/banking/BankingView.tsx', 'utf8');
console.log(text.substring(0, 1500));
