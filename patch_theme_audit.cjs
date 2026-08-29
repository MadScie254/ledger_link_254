const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir(srcDir, function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Replace explicit dark mode backgrounds with the semantic variables
    content = content.replace(/bg-white dark:bg-\[\#111827\]/g, 'bg-paper-100');
    content = content.replace(/bg-white dark:bg-\[\#0B0F19\]/g, 'bg-paper-50');
    content = content.replace(/bg-white dark:bg-ink-900\/(\d+)/g, 'bg-paper-100');
    content = content.replace(/bg-white dark:bg-ink-900/g, 'bg-paper-100');
    content = content.replace(/dark:bg-ink-900\/\d+/g, ''); // Removes remaining dark mode specific opacity backgrounds
    content = content.replace(/dark:bg-\[\#111827\]/g, ''); 
    content = content.replace(/dark:bg-[#0B0F19]/g, '');

    // The text-ink-900 already switches automatically because of CSS variables.
    // However, some places have dark:text-slate-900 which is wrong because text-ink-900 handles it.
    content = content.replace(/dark:text-slate-900/g, '');
    
    fs.writeFileSync(filePath, content, 'utf-8');
  }
});

console.log("Class audit replacement complete!");
