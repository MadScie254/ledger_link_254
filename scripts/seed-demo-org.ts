import 'dotenv/config';
import { getSupabase } from '../src/server/supabase';
import { CustomerService } from '../src/server/customers';
import { VendorService } from '../src/server/vendors';
import { InvoiceService } from '../src/server/invoices';
import { BillService } from '../src/server/bills';
import { LedgerService } from '../src/server/ledger';
import { AccountService } from '../src/server/accounts';
const supabase = getSupabase();

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function seedDemoOrg() {
  console.log('Seeding Demo Organization...');
  const userId = 'demo-seed-user';

  // 1. Create Organization
  const { data: orgData, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: 'Acme Demo Corp',
      fiscal_year_start: 'January',
      base_currency: 'KES',
      tax_id: 'P012345678Z',
      is_demo: true
    })
    .select('id')
    .single();

  if (orgError) throw orgError;
  const orgId = orgData.id;
  console.log(`Created Demo Org ID: ${orgId}`);

  // 1b. Wait a sec for triggers (default accounts)
  await delay(1000);
  const bankAccount = await AccountService.getAccountByCode(orgId, '1000');
  const arAccount = await AccountService.getAccountByCode(orgId, '1100');
  const apAccount = await AccountService.getAccountByCode(orgId, '2000');
  const salesAccount = await AccountService.getAccountByCode(orgId, '4000');
  const opAccount = await AccountService.getAccountByCode(orgId, '6000');
  const vatAccount = await AccountService.getAccountByCode(orgId, '2100');

  // 2. Customers
  const customers = [
    { displayName: 'Safaricom PLC', email: 'billing@safaricom.co.ke', currency: 'KES' },
    { displayName: 'Equity Bank', email: 'vendors@equitybank.co.ke', currency: 'KES' }
  ];
  
  const customerIds = [];
  for (const c of customers) {
    const cid = await CustomerService.createCustomer(orgId, c);
    customerIds.push(cid);
  }
  console.log('Customers seeded');

  // 3. Vendors
  const vendors = [
    { displayName: 'Kenya Power', email: 'billing@kplc.co.ke', currency: 'KES' },
    { displayName: 'Shell Petrol', email: 'invoicing@shell.co.ke', currency: 'KES' }
  ];

  const vendorIds = [];
  for (const v of vendors) {
    const vid = await VendorService.createVendor(orgId, v);
    vendorIds.push(vid);
  }
  console.log('Vendors seeded');

  // 4. Invoices (6 months of data)
  const now = new Date();
  const invoiceIds = [];
  
  for (let i = 0; i < 6; i++) {
    const invDate = new Date(now.getFullYear(), now.getMonth() - i, 5);
    const dueDate = new Date(invDate);
    dueDate.setDate(dueDate.getDate() + 30);
    
    // Safaricom
    const inv1Id = await InvoiceService.createInvoice({
      orgId,
      customerId: customerIds[0],
      issueDate: invDate.toISOString().substring(0, 10),
      dueDate: dueDate.toISOString().substring(0, 10),
      currency: 'KES',
      subtotalCents: 15000000,
      taxCents: 2400000,
      totalCents: 17400000,
      status: i > 1 ? 'PAID' : 'OPEN', // older ones paid
      notes: 'Monthly retainer',
      createdBy: userId,
      items: [
        {
          description: 'Software Consulting',
          quantity: 1,
          unitPriceCents: 15000000,
          totalCents: 15000000,
          accountId: salesAccount?.id
        }
      ]
    });
    invoiceIds.push({ id: inv1Id, date: invDate, customer: customers[0].name, amount: 17400000, paid: i > 1 });

    // Equity Bank
    const inv2Id = await InvoiceService.createInvoice({
      orgId,
      customerId: customerIds[1],
      issueDate: invDate.toISOString().substring(0, 10),
      dueDate: dueDate.toISOString().substring(0, 10),
      currency: 'KES',
      subtotalCents: 20000000,
      taxCents: 3200000,
      totalCents: 23200000,
      status: i > 0 ? 'PAID' : 'OPEN',
      notes: 'System maintenance',
      createdBy: userId,
      items: [
        {
          description: 'Maintenance Contract',
          quantity: 1,
          unitPriceCents: 20000000,
          totalCents: 20000000,
          accountId: salesAccount?.id
        }
      ]
    });
    invoiceIds.push({ id: inv2Id, date: invDate, customer: customers[1].name, amount: 23200000, paid: i > 0 });
  }

  // 5. Bills
  for (let i = 0; i < 6; i++) {
    const billDate = new Date(now.getFullYear(), now.getMonth() - i, 15);
    const dueDate = new Date(billDate);
    dueDate.setDate(dueDate.getDate() + 30);

    // KPLC
    await BillService.createBill({
      orgId,
      vendorId: vendorIds[0],
      issueDate: billDate.toISOString().substring(0, 10),
      dueDate: dueDate.toISOString().substring(0, 10),
      currency: 'KES',
      subtotalCents: 4500000,
      taxCents: 720000,
      totalCents: 5220000,
      status: i > 0 ? 'PAID' : 'OPEN',
      notes: 'Monthly electricity',
      createdBy: userId,
      items: [
        {
          description: 'Electricity Bill',
          quantity: 1,
          unitPriceCents: 4500000,
          totalCents: 4500000,
          accountId: opAccount?.id
        }
      ]
    });

    // Shell
    await BillService.createBill({
      orgId,
      vendorId: vendorIds[1],
      issueDate: billDate.toISOString().substring(0, 10),
      dueDate: dueDate.toISOString().substring(0, 10),
      currency: 'KES',
      subtotalCents: 2500000,
      taxCents: 400000,
      totalCents: 2900000,
      status: 'PAID', // Always paid
      notes: 'Fuel',
      createdBy: userId,
      items: [
        {
          description: 'Vehicle Fuel',
          quantity: 1,
          unitPriceCents: 2500000,
          totalCents: 2500000,
          accountId: opAccount?.id
        }
      ]
    });
  }

  // 6. Direct insert fake bank transactions & payments for paid invoices
  const bankMocks = [];
  
  for (const inv of invoiceIds) {
    if (inv.paid) {
      const payDate = new Date(inv.date);
      payDate.setDate(payDate.getDate() + 10);
      const isoDate = payDate.toISOString();
      
      // Payment journal entry
      await LedgerService.postJournalEntry({
        orgId,
        entryDate: isoDate.substring(0, 10),
        memo: `Payment for Invoice ${inv.id}`,
        sourceType: 'INVOICE',
        sourceId: inv.id,
        createdBy: userId,
        lines: [
          { accountId: bankAccount!.id, debit: inv.amount, credit: 0, description: 'Invoice payment received' },
          { accountId: arAccount!.id, debit: 0, credit: inv.amount, description: 'Invoice payment received' }
        ]
      });

      // Bank transaction
      bankMocks.push({
        org_id: orgId,
        date: isoDate,
        description: `WIRE TRF ${inv.customer}`,
        amount_cents: inv.amount,
        direction: 'IN',
        status: 'MATCHED',
        ai_category_code: '1100',
        ai_category_name: 'Accounts Receivable'
      });
    }

    // Add etims submission
    await supabase.from('etims_submissions').insert({
      org_id: orgId,
      invoice_id: inv.id,
      status: 'SUCCESS',
      submitted_at: inv.date.toISOString(),
      kra_control_code: 'KRA-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
      qr_code_url: 'https://etims.kra.go.ke/verify'
    });
  }

  if (bankMocks.length > 0) {
    await supabase.from('bank_transactions').insert(bankMocks);
  }

  console.log('Invoices, Bills, Ledger, Bank Transactions, and eTIMS seeded.');
  console.log('Seed Complete!');
}

seedDemoOrg().catch(console.error);
