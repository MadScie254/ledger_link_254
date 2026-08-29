const fs = require('fs');

// Patch Sidebar
let text = fs.readFileSync('src/components/layout/Sidebar.tsx', 'utf8');

if (!text.includes('System Health')) {
  const sidebarSearch = "{ name: 'Audit Logs', icon: FileText },";
  const sidebarReplace = "{ name: 'Audit Logs', icon: FileText },\n    { name: 'System Health', icon: Activity },";
  text = text.replace(sidebarSearch, sidebarReplace);

  if (!text.includes('Activity')) {
    text = text.replace("FileText, Search", "FileText, Search, Activity");
  }
}
fs.writeFileSync('src/components/layout/Sidebar.tsx', text);

// Patch Command Palette
let text2 = fs.readFileSync('src/components/layout/CommandPalette.tsx', 'utf8');
if (!text2.includes('System Health')) {
  const paletteSearch = "{ name: 'Audit Logs', view: 'Audit Logs', type: 'View' },";
  const paletteReplace = "{ name: 'Audit Logs', view: 'Audit Logs', type: 'View' },\n    { name: 'System Health', view: 'System Health', type: 'View' },";
  
  // if paletteSearch exists
  if (text2.includes(paletteSearch)) {
     text2 = text2.replace(paletteSearch, paletteReplace);
  } else {
     // fallback
     text2 = text2.replace("{ name: 'Audit Logs', view: 'Audit Logs' },", "{ name: 'Audit Logs', view: 'Audit Logs' },\n    { name: 'System Health', view: 'System Health' },");
  }
}
fs.writeFileSync('src/components/layout/CommandPalette.tsx', text2);

console.log("Success Sidebar and Palette");
