const fs = require('fs');
const views = [
  { path: 'src/components/dashboard/DashboardView.tsx', name: 'DashboardView' },
  { path: 'src/components/sales/SalesView.tsx', name: 'SalesView' },
  { path: 'src/components/banking/BankingView.tsx', name: 'BankingView' }
];

views.forEach(v => {
  let text = fs.readFileSync(v.path, 'utf8');
  if (!text.includes('useRenderTracker')) {
    text = text.replace("import { useState } from 'react';", "import { useState } from 'react';\nimport { useRenderTracker } from '../../utils/monitoring';");
    text = text.replace("import { useState, useMemo } from 'react';", "import { useState, useMemo } from 'react';\nimport { useRenderTracker } from '../../utils/monitoring';");
    // Some might not have useState imported alone.
    // Try to find the export function
    
    if (v.name === 'DashboardView') {
        text = text.replace('export function DashboardView() {', 'export function DashboardView() {\n  useRenderTracker("DashboardView");');
    } else if (v.name === 'SalesView') {
        text = text.replace('export function SalesView() {', 'export function SalesView() {\n  useRenderTracker("SalesView");');
    } else if (v.name === 'BankingView') {
        text = text.replace('export function BankingView() {', 'export function BankingView() {\n  useRenderTracker("BankingView");');
    }
    fs.writeFileSync(v.path, text);
  }
});
console.log("Success Render Tracker");
