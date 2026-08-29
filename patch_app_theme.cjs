const fs = require('fs');

// Patch App.tsx
let appText = fs.readFileSync('src/App.tsx', 'utf8');
appText = appText.replace(/const { activeView, setActiveView, theme, isLocked, setLocked } = useAppStore\(\);/, "const { activeView, setActiveView, isLocked, setLocked } = useAppStore();");
appText = appText.replace(/useEffect\(\(\) => \{\s*if \(theme === 'dark'\) \{\s*document\.documentElement\.classList\.add\('dark'\);\s*\} else \{\s*document\.documentElement\.classList\.remove\('dark'\);\s*\}\s*\}, \[theme\]\);/, "");
fs.writeFileSync('src/App.tsx', appText);

// Patch store.ts
let storeText = fs.readFileSync('src/store.ts', 'utf8');
storeText = storeText.replace(/theme: 'light' \| 'dark';\s*toggleTheme: \(\) => void;/m, "");
storeText = storeText.replace(/theme: 'light',\s*toggleTheme: \(\) => set\(\(state\) => \(\{ theme: state\.theme === 'light' \? 'dark' : 'light' \}\)\),/m, "");
fs.writeFileSync('src/store.ts', storeText);

console.log("Success");
