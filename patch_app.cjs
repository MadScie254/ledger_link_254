const fs = require('fs');
let text = fs.readFileSync('src/App.tsx', 'utf8');

if (!text.includes('SystemHealthView')) {
  text = text.replace('import { AuditLogView } from "./components/audit/AuditLogView";', 'import { AuditLogView } from "./components/audit/AuditLogView";\nimport { SystemHealthView } from "./components/health/SystemHealthView";\nimport { TenantProvider } from "./context/TenantContext";\nimport { fetchWithTenant } from "./utils/api";');
}

const fetchSearch = /const res = await fetch\("\/api\/accounts", \{\s*headers: \{ "x-org-id": "default-org-id" \},\s*\}\);/;
const fetchReplace = 'const res = await fetchWithTenant("/api/accounts");';
text = text.replace(fetchSearch, fetchReplace);

const renderSearch = 'if (activeView === "Audit Logs") return <AuditLogView />;'
const renderReplace = 'if (activeView === "Audit Logs") return <AuditLogView />;\n    if (activeView === "System Health") return <SystemHealthView />;'
text = text.replace(renderSearch, renderReplace);

const layoutSearch = '<AppLayout>{renderContent()}</AppLayout>';
const layoutReplace = '<TenantProvider>\n        <AppLayout>{renderContent()}</AppLayout>\n      </TenantProvider>';
text = text.replace(layoutSearch, layoutReplace);

fs.writeFileSync('src/App.tsx', text);
console.log("Success App");
