import 'dotenv/config';
import { getSupabase } from '../src/server/supabase';
import { CustomerService } from '../src/server/customers';
import { VendorService } from '../src/server/vendors';
import { InvoiceService } from '../src/server/invoices';
import { BillService } from '../src/server/bills';
import { AccountService } from '../src/server/accounts';
import { OrganizationService } from '../src/server/organizations';
const supabase = getSupabase();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function seedDemoOrg() {
  console.log('Seeding Demo Organization...');
  const userId = process.env.DEMO_USER_ID?.trim() || '';
  if (!UUID_PATTERN.test(userId)) {
    throw new Error('DEMO_USER_ID must be the UUID of an existing Supabase Auth user.');
  }

  // 1. Create Organization
  const orgId = await OrganizationService.createOrganization({
    name: 'Acme Demo Corp',
    legalName: 'Acme Demo Corp',
    fiscalYearStart: 'January',
    baseCurrency: 'KES',
    country: 'Kenya',
    taxId: 'P012345678Z',
    isDemo: true,
  }, userId);
  console.log(`Created Demo Org ID: ${orgId}`);

  const bankAccount = await AccountService.getAccountByCode(orgId, '1000');
  const salesAccount = await AccountService.getAccountByCode(orgId, '4000');
  const opAccount = await AccountService.getAccountByCode(orgId, '6000');
  if (!bankAccount || !salesAccount || !opAccount) {
    throw new Error('The demo chart of accounts was not initialized.');
  }

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
      idempotencyKey: crypto.randomUUID(),
      notes: 'Monthly retainer',
      createdBy: userId,
      lines: [
        {
          description: 'Software Consulting',
          amountCents: 17400000,
          accountId: salesAccount!.id
        }
      ]
    });
    invoiceIds.push({ id: inv1Id, date: invDate, customer: customers[0].displayName, amount: 17400000, paid: i > 1 });

    // Equity Bank
    const inv2Id = await InvoiceService.createInvoice({
      orgId,
      customerId: customerIds[1],
      issueDate: invDate.toISOString().substring(0, 10),
      dueDate: dueDate.toISOString().substring(0, 10),
      currency: 'KES',
      idempotencyKey: crypto.randomUUID(),
      notes: 'System maintenance',
      createdBy: userId,
      lines: [
        {
          description: 'Maintenance Contract',
          amountCents: 23200000,
          accountId: salesAccount!.id
        }
      ]
    });
    invoiceIds.push({ id: inv2Id, date: invDate, customer: customers[1].displayName, amount: 23200000, paid: i > 0 });
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
      billDate: billDate.toISOString().substring(0, 10),
      dueDate: dueDate.toISOString().substring(0, 10),
      currency: 'KES',
      idempotencyKey: crypto.randomUUID(),
      notes: 'Monthly electricity',
      createdBy: userId,
      lines: [
        {
          description: 'Electricity Bill',
          amountCents: 5220000,
          accountId: opAccount!.id
        }
      ]
    });

    // Shell
    await BillService.createBill({
      orgId,
      vendorId: vendorIds[1],
      billDate: billDate.toISOString().substring(0, 10),
      dueDate: dueDate.toISOString().substring(0, 10),
      currency: 'KES',
      idempotencyKey: crypto.randomUUID(),
      notes: 'Fuel',
      createdBy: userId,
      lines: [
        {
          description: 'Vehicle Fuel',
          amountCents: 2900000,
          accountId: opAccount!.id
        }
      ]
    });
  }

  // 6. Seed matching statement lines for invoices paid through the atomic workflow.
  const bankTransactions = [];
  
  for (const inv of invoiceIds) {
    if (inv.paid) {
      const payDate = new Date(inv.date);
      payDate.setDate(payDate.getDate() + 10);
      const isoDate = payDate.toISOString();
      
      const payment = await InvoiceService.receivePayment(orgId, inv.id, {
        amountCents: inv.amount,
        paymentDate: isoDate.substring(0, 10),
        depositAccountId: bankAccount.id,
        idempotencyKey: crypto.randomUUID(),
        createdBy: userId,
      });

      // Bank transaction
      bankTransactions.push({
        org_id: orgId,
        date: isoDate,
        description: `WIRE TRF ${inv.customer}`,
        amount_cents: inv.amount,
        direction: 'IN',
        status: 'MATCHED',
        matched_journal_entry_id: payment.journalEntryId,
        ai_category_code: '1100',
        ai_category_name: 'Accounts Receivable'
      });
    }

    // Add etims submission
    const { error: etimsError } = await supabase
      .from('etims_submissions')
      .update({
        status: 'SUCCESS',
        submitted_at: inv.date.toISOString(),
        kra_control_code: 'KRA-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
        qr_code_url: 'https://etims.kra.go.ke/verify'
      })
      .eq('org_id', orgId)
      .eq('invoice_id', inv.id);
    if (etimsError) throw etimsError;
  }

  if (bankTransactions.length > 0) {
    await supabase.from('bank_transactions').insert(bankTransactions);
  }

  console.log('Invoices, Bills, Ledger, Bank Transactions, and eTIMS seeded.');
  console.log('Seed Complete!');
}

seedDemoOrg().catch(console.error);
