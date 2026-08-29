const fs = require('fs');
let text = fs.readFileSync('src/App.tsx', 'utf8');

text = text.replace('setLocked(true);', 'setLocked(true);\n          sessionStorage.clear();\n          localStorage.removeItem("ledgerline-auth");');

fs.writeFileSync('src/App.tsx', text);
console.log("Success");
