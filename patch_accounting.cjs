const fs = require('fs');
let text = fs.readFileSync('src/components/accounting/AccountingView.tsx', 'utf8');

const search = `          if (!res.ok) throw new Error('Failed to import accounts');
          const data = await res.json();
          alert(\`Import complete: \${data.success} successful, \${data.failed} failed/skipped.\`);
          queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
        } catch (err) {`;

const replacement = `          if (!res.ok) throw new Error('Failed to import accounts');
          const data = await res.json();
          alert(\`Import complete: \${data.success} successful, \${data.failed} failed/skipped.\`);
          queryClient.invalidateQueries({ queryKey: ['accounts', currentOrgId] });
          
          if (data.accountIds && data.accountIds.length > 0) {
            useAppStore.getState().pushUndoAction({
              id: Math.random().toString(),
              message: \`Imported \${data.success} accounts\`,
              revertEndpoint: '/api/accounts/undo-bulk',
              data: { accountIds: data.accountIds }
            });
          }
        } catch (err) {`;

if (text.includes(search)) {
  fs.writeFileSync('src/components/accounting/AccountingView.tsx', text.replace(search, replacement));
  console.log("Success");
} else {
  console.error("Not found");
}
