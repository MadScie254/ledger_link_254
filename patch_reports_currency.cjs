const fs = require('fs');
let text = fs.readFileSync('src/components/reports/ReportsView.tsx', 'utf8');

if (!text.includes('useAppStore')) {
  text = text.replace("import { useState } from 'react';", "import { useState } from 'react';\nimport { useAppStore } from '../../store';");
}

const hookSearch = "export function ReportsView() {\n  const [activeTab, setActiveTab] = useState('Standard reports');";
const hookReplacement = "export function ReportsView() {\n  const { displayCurrency, setDisplayCurrency } = useAppStore();\n  const [activeTab, setActiveTab] = useState('Standard reports');";
text = text.replace(hookSearch, hookReplacement);

const headerSearch = `      <div className="mb-2">
        <h1 className="text-2xl font-serif text-ink-900">Reports</h1>
      </div>`;
const headerReplacement = `      <div className="mb-2 flex justify-between items-center">
        <h1 className="text-2xl font-serif text-ink-900">Reports</h1>
        <div className="flex items-center space-x-2">
          <label className="text-sm text-slate-500 font-medium">Currency:</label>
          <select 
            value={displayCurrency}
            onChange={(e) => setDisplayCurrency(e.target.value)}
            className="bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 text-sm rounded-sm px-2 py-1 outline-none focus:ring-1 focus:ring-focus-blue-500"
          >
            <option value="KES">KES - Kenyan Shilling</option>
            <option value="USD">USD - US Dollar</option>
            <option value="EUR">EUR - Euro</option>
            <option value="GBP">GBP - British Pound</option>
            <option value="UGX">UGX - Ugandan Shilling</option>
            <option value="TZS">TZS - Tanzanian Shilling</option>
          </select>
        </div>
      </div>`;
text = text.replace(headerSearch, headerReplacement);

fs.writeFileSync('src/components/reports/ReportsView.tsx', text);
console.log("Success");
