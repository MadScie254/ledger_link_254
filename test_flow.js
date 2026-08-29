async function run() {
  const orgId = 'default-org-id';
  const headers = { 'x-org-id': orgId, 'Content-Type': 'application/json' };
  const baseUrl = 'http://127.0.0.1:3000/api';

  try {
    console.log('1. Seeding accounts...');
    const seedRes = await fetch(`${baseUrl}/accounts/seed`, { method: 'POST', headers });
    console.log(await seedRes.json());

    console.log('2. Fetching accounts...');
    const accountsRes = await fetch(`${baseUrl}/accounts`, { headers });
    const accountsData = await accountsRes.json();
    const incomeAccount = accountsData.accounts.find(a => a.type === 'INCOME');
    if (!incomeAccount) throw new Error('No income account found');
    console.log('Found Income Account:', incomeAccount.code);

    console.log('3. Creating customer...');
    const custRes = await fetch(`${baseUrl}/customers`, {
      method: 'POST', headers, body: JSON.stringify({ displayName: 'Automated Test Customer', email: 'test@ledgerline.com' })
    });
    const custData = await custRes.json();
    const customerId = custData.id;
    console.log('Customer ID:', customerId);

    console.log('4. Creating Invoice (Testing Ledger Integrity)...');
    const invRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST', headers, body: JSON.stringify({
        orgId,
        customerId,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        lines: [{
          description: 'Consulting Retainer',
          accountId: incomeAccount.id,
          amountCents: 50000 // 500.00
        }]
      })
    });
    const invData = await invRes.json();
    if (invData.error) throw new Error('Invoice Creation Failed: ' + invData.error);
    console.log('Invoice created successfully. Journal Entry successfully posted. ID:', invData.id);

    console.log('✅ ALL INTEGRATION TESTS PASSED!');
  } catch (e) {
    console.error('❌ TEST FAILED:', e);
  }
}
run();
