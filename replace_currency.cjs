const fs = require('fs');
const path = require('path');

const currencyPath = "import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';\n";
const currencyPathShort = "import { formatCurrency, formatCurrencyFromFloat } from '../utils/currency';\n";

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  // Replace (amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // We'll just regex for .toLocaleString('en-US', ...)
  
  // Case 1: (amountCents / 100).toLocaleString('en-US', ...)
  // e.g. (inv.totalCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  content = content.replace(/\(([^)]+)\s*\/\s*100\)\.toLocaleString\('en-US'[^)]+\)/g, 'formatCurrency($1)');
  
  // Case 2: variable.toLocaleString('en-US', ...) where variable is a float
  content = content.replace(/([a-zA-Z0-9_.]+)\.toLocaleString\('en-US'[^)]+\)/g, 'formatCurrencyFromFloat($1)');
  
  if (content !== originalContent) {
    // Add import
    const depth = filePath.split('/').length - 2; // src is depth 1
    const importStr = depth === 2 ? "import { formatCurrency, formatCurrencyFromFloat } from '../../utils/currency';\n" : "import { formatCurrency, formatCurrencyFromFloat } from '../utils/currency';\n";
    
    // insert import after standard imports
    content = importStr + content;
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Updated ' + filePath);
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      processFile(fullPath);
    }
  }
}

walk('src/components');
