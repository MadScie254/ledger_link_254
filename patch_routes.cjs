const fs = require('fs');
let text = fs.readFileSync('src/server/routes.ts', 'utf8');
const search = `apiRouter.post('/accounts/bulk', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const { accounts } = req.body;
    const result = await AccountService.bulkCreateAccounts(orgId, accounts, userId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});`;

const replacement = `apiRouter.post('/accounts/bulk', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const { accounts } = req.body;
    const result = await AccountService.bulkCreateAccounts(orgId, accounts, userId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/accounts/undo-bulk', async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const userId = (req as any).userId;
    const { accountIds } = req.body;
    await AccountService.bulkDeleteAccounts(orgId, accountIds, userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});`;

if (text.includes(search)) {
  fs.writeFileSync('src/server/routes.ts', text.replace(search, replacement));
  console.log("Success");
} else {
  console.error("Not found");
}
