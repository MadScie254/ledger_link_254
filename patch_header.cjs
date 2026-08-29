const fs = require('fs');
let text = fs.readFileSync('src/components/layout/Header.tsx', 'utf8');

text = text.replace("Moon, Sun", "");
text = text.replace("const { setCommandPaletteOpen, theme, toggleTheme } = useAppStore();", "const { setCommandPaletteOpen } = useAppStore();");
text = text.replace(/<button onClick=\{toggleTheme\}[^>]*>[\s\S]*?<\/button>/m, "");

fs.writeFileSync('src/components/layout/Header.tsx', text);
console.log("Success");
