/**
 * The product tour, as data. Kept apart from the component so a test can check
 * every step against the real app: each `view` must be a real page, and each
 * `target` must be an anchor that exists in the source. A step that points at
 * nothing is the failure this file exists to prevent.
 *
 * Copy rules: written for someone who has never used bookkeeping software.
 * Short sentences, active voice, one idea per step, and every accounting word
 * explained the first time it appears. Page and tab names stay in English in
 * both languages because that is what the screen shows.
 */

export type Language = 'en' | 'sw';
export type Copy = Record<Language, string>;

export type ChapterId = 'start' | 'money' | 'books' | 'office' | 'finish';

export type TourIcon =
  | 'book'
  | 'sidebar'
  | 'search'
  | 'bell'
  | 'dashboard'
  | 'bank'
  | 'invoice'
  | 'customers'
  | 'bills'
  | 'accounting'
  | 'reports'
  | 'tax'
  | 'payroll'
  | 'inventory'
  | 'projects'
  | 'feed'
  | 'team'
  | 'plug'
  | 'audit'
  | 'settings'
  | 'help'
  | 'done';

export interface TourPoint {
  term: Copy;
  text: Copy;
}

export interface TourStep {
  id: string;
  chapter: ChapterId;
  title: Copy;
  body: Copy;
  /** Short ruled facts under the paragraph: a term, then what it means. */
  points?: TourPoint[];
  /** Where the page sits in the navigation, as the screen labels it. */
  path?: string;
  /** Store view key opened for this step. */
  view?: string;
  /** Selector for the spotlight. Several elements may match; the first visible one wins. */
  target?: string;
  icon: TourIcon;
}

export const CHAPTERS: Record<ChapterId, Copy> = {
  start: { en: 'Getting around', sw: 'Kuzoea mfumo' },
  money: { en: 'Money', sw: 'Fedha' },
  books: { en: 'Books', sw: 'Vitabu' },
  office: { en: 'Office', sw: 'Ofisi' },
  finish: { en: 'Finish', sw: 'Mwisho' },
};

const point = (termEn: string, textEn: string, termSw: string, textSw: string): TourPoint => ({
  term: { en: termEn, sw: termSw },
  text: { en: textEn, sw: textSw },
});

export const TOUR_STEPS: TourStep[] = [
  // ── Getting around ────────────────────────────────────────────────────────
  {
    id: 'welcome',
    chapter: 'start',
    icon: 'book',
    view: 'Home / Dashboard',
    target: '[data-tour="app-location"]',
    title: { en: 'Welcome to your books', sw: 'Karibu kwenye vitabu vyako' },
    body: {
      en: 'Ledger Link is where your business keeps its financial records. You record what you sell, what you buy and what you pay. Ledger Link then builds your reports from those records. Accountants call these records “the books”.',
      sw: 'Ledger Link ni mahali biashara yako inatunza kumbukumbu za fedha. Unarekodi unachouza, unachonunua na unacholipa. Kisha Ledger Link inatengeneza ripoti zako kutokana na rekodi hizo. Wahasibu huziita rekodi hizi “vitabu”.',
    },
    points: [
      point('This strip', 'Shows which business is open and which page you are on.', 'Ukanda huu', 'Unaonyesha biashara iliyofunguliwa na ukurasa uliopo.'),
      point('Safe to follow', 'The tour only looks. It never creates, changes or deletes anything.', 'Ni salama', 'Mafunzo yanaangalia tu. Hayaundi, hayabadilishi wala hayafuti chochote.'),
      point('Your place is saved', 'Stop whenever you like and carry on later.', 'Mahali pako pamehifadhiwa', 'Unaweza kuacha wakati wowote na kuendelea baadaye.'),
    ],
  },
  {
    id: 'sidebar',
    chapter: 'start',
    icon: 'sidebar',
    view: 'Home / Dashboard',
    target: '[data-tour="sidebar-index"]',
    title: { en: 'Every page is in this list', sw: 'Kila ukurasa uko kwenye orodha hii' },
    body: {
      en: 'Ledger Link is split into pages, and this list opens each one. On a computer it runs down the left side. On a phone it is the bar at the bottom, and “More” shows the rest.',
      sw: 'Ledger Link imegawanywa katika kurasa, na orodha hii inafungua kila ukurasa. Kwenye kompyuta iko upande wa kushoto. Kwenye simu ni upau wa chini, na “More” inaonyesha zilizobaki.',
    },
    points: [
      point('Money', 'Day-to-day work: Home, Banking, Sales, Customers, Bills and expenses.', 'Money', 'Kazi za kila siku: Home, Banking, Sales, Customers, Bills and expenses.'),
      point('Books', 'Records and reports: Accounting, Reports, Tax, Payroll, Inventory, Projects.', 'Books', 'Rekodi na ripoti: Accounting, Reports, Tax, Payroll, Inventory, Projects.'),
      point('Office', 'Running the business: Business feed, Team, Integrations, Audit log, Documentation, Settings.', 'Office', 'Kuendesha biashara: Business feed, Team, Integrations, Audit log, Documentation, Settings.'),
    ],
  },
  {
    id: 'search',
    chapter: 'start',
    icon: 'search',
    view: 'Home / Dashboard',
    target: '[data-tour="header-search"]',
    title: { en: 'Find anything by typing', sw: 'Tafuta chochote kwa kuandika' },
    body: {
      en: 'Search takes you to a page, a customer, an invoice or a report without clicking through menus.',
      sw: 'Utafutaji unakupeleka kwenye ukurasa, mteja, ankara au ripoti bila kupitia menyu nyingi.',
    },
    points: [
      point('On a computer', 'Press Ctrl and K together, or click the search box.', 'Kwenye kompyuta', 'Bonyeza Ctrl na K pamoja, au bofya kisanduku cha kutafuta.'),
      point('On a phone', 'Tap the magnifying glass at the top.', 'Kwenye simu', 'Gusa kioo cha kukuza juu ya skrini.'),
      point('Try it', 'Type “sales” and press Enter to open the Sales page.', 'Jaribu', 'Andika “sales” kisha bonyeza Enter kufungua ukurasa wa Sales.'),
    ],
  },
  {
    id: 'bell',
    chapter: 'start',
    icon: 'bell',
    view: 'Home / Dashboard',
    target: '[data-tour="notifications"]',
    title: { en: 'The bell shows what needs attention', sw: 'Kengele inaonyesha kinachohitaji umakini' },
    body: {
      en: 'Ledger Link checks your books and lists things that need action. Select an item to go straight to it.',
      sw: 'Ledger Link inakagua vitabu vyako na kuorodhesha mambo yanayohitaji hatua. Chagua kipengee ili kwenda moja kwa moja kwake.',
    },
    points: [
      point('Overdue invoices', 'Customers who are late paying you.', 'Ankara zilizochelewa', 'Wateja waliochelewa kukulipa.'),
      point('Deadlines', 'KRA and payroll dates coming up.', 'Tarehe za mwisho', 'Tarehe za KRA na mishahara zinazokaribia.'),
      point('Low stock', 'Items that have reached their reorder point.', 'Bidhaa zinazoisha', 'Bidhaa zilizofikia kiwango cha kuagiza tena.'),
    ],
  },

  // ── Money ─────────────────────────────────────────────────────────────────
  {
    id: 'home',
    chapter: 'money',
    icon: 'dashboard',
    path: 'Money › Home',
    view: 'Home / Dashboard',
    target: '[data-tour="dashboard-summary"]',
    title: { en: 'Home: how the business stands today', sw: 'Home: hali ya biashara leo' },
    body: {
      en: 'Home answers four questions in one row. Read them from left to right.',
      sw: 'Home inajibu maswali manne kwenye safu moja. Yasome kutoka kushoto kwenda kulia.',
    },
    points: [
      point('Cash', 'Money you hold now, in the bank and in mobile-money accounts.', 'Cash', 'Fedha ulizo nazo sasa, benki na kwenye akaunti za pesa za simu.'),
      point('Owed to you', 'Money customers still have to pay. These are your unpaid invoices.', 'Owed to you', 'Fedha ambazo wateja bado hawajalipa. Hizi ni ankara zako ambazo hazijalipwa.'),
      point('You owe', 'Money you still have to pay suppliers. These are your unpaid bills.', 'You owe', 'Fedha ambazo bado unadaiwa na wasambazaji. Hizi ni bili zako ambazo hazijalipwa.'),
      point('Net profit', 'What is left of your sales after the cost of goods and expenses.', 'Net profit', 'Kinachobaki kwenye mauzo baada ya gharama za bidhaa na matumizi.'),
    ],
  },
  {
    id: 'banking',
    chapter: 'money',
    icon: 'bank',
    path: 'Money › Banking',
    view: 'Banking',
    target: '[data-tour="banking-overview"]',
    title: { en: 'Banking: match the bank to your books', sw: 'Banking: linganisha benki na vitabu vyako' },
    body: {
      en: 'Your bank and M-Pesa report every payment in and out. Banking lists those lines so you can tell the books what each one was for. That keeps your records honest.',
      sw: 'Benki yako na M-Pesa huripoti kila malipo yanayoingia na kutoka. Banking inaorodhesha miamala hiyo ili uambie vitabu kila mmoja ulikuwa wa nini. Hii huweka rekodi zako sahihi.',
    },
    points: [
      point('Statement lines', 'The payments your bank or M-Pesa reported.', 'Statement lines', 'Malipo yaliyoripotiwa na benki au M-Pesa.'),
      point('Suggested matches', 'Ledger Link suggests which invoice or bill a line belongs to. Check each one before you accept it.', 'Suggested matches', 'Ledger Link inapendekeza ankara au bili ambayo muamala unahusu. Kagua kila moja kabla ya kukubali.'),
      point('Rules', 'Say once that lines with a certain name always go to one account. Later lines are filed the same way.', 'Rules', 'Sema mara moja kwamba miamala yenye jina fulani huenda kwenye akaunti moja. Miamala ijayo itapangwa vivyo hivyo.'),
      point('Reconcile', 'To reconcile is to check that your books and your bank statement agree.', 'Reconcile', 'Kulinganisha ni kukagua kwamba vitabu vyako na taarifa ya benki vinakubaliana.'),
    ],
  },
  {
    id: 'sales',
    chapter: 'money',
    icon: 'invoice',
    path: 'Money › Sales',
    view: 'Sales',
    target: '[data-tour="new-invoice"]',
    title: { en: 'Sales: send an invoice', sw: 'Sales: tuma ankara' },
    body: {
      en: 'An invoice is a request for payment that you send a customer for something you sold. Select New invoice, choose the customer, add what you sold, and Ledger Link posts the sale to your books.',
      sw: 'Ankara ni ombi la malipo unalomtumia mteja kwa kitu ulichouza. Chagua New invoice, chagua mteja, ongeza ulichouza, kisha Ledger Link inaweka mauzo kwenye vitabu vyako.',
    },
    points: [
      point('VAT', 'Each line can carry VAT. Ledger Link works out the tax for you.', 'VAT', 'Kila mstari unaweza kuwa na VAT. Ledger Link inakokotoa kodi kwa niaba yako.'),
      point('Awaiting payment', 'Sent, and the customer has not paid yet.', 'Awaiting payment', 'Imetumwa, mteja hajalipa bado.'),
      point('Overdue', 'The due date has passed and it is still unpaid.', 'Overdue', 'Tarehe ya mwisho imepita na bado haijalipwa.'),
      point('Receive payment', 'When the customer pays, open the invoice and record the payment.', 'Receive payment', 'Mteja akilipa, fungua ankara na urekodi malipo.'),
    ],
  },
  {
    id: 'customers',
    chapter: 'money',
    icon: 'customers',
    path: 'Money › Customers',
    view: 'Customer Hub',
    target: '[data-tour="customers-overview"]',
    title: { en: 'Customers: who buys from you', sw: 'Customers: wanaonunua kwako' },
    body: {
      en: 'Keep one record for each customer. Add a customer once, then pick them each time you write an invoice.',
      sw: 'Weka rekodi moja kwa kila mteja. Ongeza mteja mara moja, kisha umchague kila unapoandika ankara.',
    },
    points: [
      point('Customers', 'Names and contact details.', 'Customers', 'Majina na mawasiliano.'),
      point('Balances owed', 'Who owes you money, and how much.', 'Balances owed', 'Nani anakudai fedha, na kiasi gani.'),
      point('Add customer', 'Start here if you have not written an invoice yet.', 'Add customer', 'Anza hapa kama bado hujaandika ankara.'),
    ],
  },
  {
    id: 'bills',
    chapter: 'money',
    icon: 'bills',
    path: 'Money › Bills and expenses',
    view: 'Expenses & Bills',
    target: '[data-tour="bills-overview"]',
    title: { en: 'Bills and expenses: what you owe', sw: 'Bills and expenses: unachodaiwa' },
    body: {
      en: 'A bill is a request for payment that a supplier sends you. Record it here when it arrives. When you pay it, record the payment so the books show it as settled.',
      sw: 'Bili ni ombi la malipo ambalo msambazaji anakutumia. Irekodi hapa inapofika. Ukilipa, rekodi malipo ili vitabu vionyeshe kuwa imelipwa.',
    },
    points: [
      point('Vendors', 'Your suppliers. Add one before you record their bill.', 'Vendors', 'Wasambazaji wako. Ongeza mmoja kabla ya kurekodi bili yake.'),
      point('Bills', 'Money you owe suppliers, with the date each is due.', 'Bills', 'Fedha unazodaiwa na wasambazaji, pamoja na tarehe ya mwisho.'),
      point('Receipts', 'Scan a receipt for something you paid for on the spot, such as fuel.', 'Receipts', 'Piga picha risiti ya ulicholipia papo hapo, kama mafuta.'),
      point('Bill payments', 'A record of the bills you have already paid.', 'Bill payments', 'Rekodi ya bili ulizokwisha kulipa.'),
    ],
  },

  // ── Books ─────────────────────────────────────────────────────────────────
  {
    id: 'accounting',
    chapter: 'books',
    icon: 'accounting',
    path: 'Books › Accounting',
    view: 'Accounting',
    target: '[data-tour="accounting-overview"]',
    title: { en: 'Accounting: where every record is filed', sw: 'Accounting: mahali kila rekodi inapohifadhiwa' },
    body: {
      en: 'Every sale, bill and payment is filed under an account. An account is a labelled bucket, such as Cash at bank or Sales revenue. Each record is written twice: once for where the money came from and once for where it went. Accountants call this double-entry, and the two sides must always be equal.',
      sw: 'Kila mauzo, bili na malipo huhifadhiwa chini ya akaunti. Akaunti ni kikapu chenye jina, kama Cash at bank au Sales revenue. Kila rekodi huandikwa mara mbili: mara moja kwa fedha zilikotoka na mara moja kwa zilikoenda. Wahasibu huita hii double-entry, na pande zote mbili lazima ziwe sawa.',
    },
    points: [
      point('Chart of accounts', 'The full list of buckets. Ledger Link starts you with a standard set.', 'Chart of accounts', 'Orodha kamili ya vikapu. Ledger Link inakupa seti ya kawaida ya kuanzia.'),
      point('Journal entries', 'Every posted record. Invoices and bills create theirs automatically.', 'Journal entries', 'Kila rekodi iliyowekwa. Ankara na bili huunda zake zenyewe.'),
      point('Post an entry', 'For adjustments no invoice or bill covers. Both sides must add up to the same total.', 'Post an entry', 'Kwa marekebisho ambayo ankara au bili haziyashughulikii. Pande zote mbili lazima zifikie jumla ile ile.'),
      point('Budgets', 'Set a spending limit for an account and watch it.', 'Budgets', 'Weka kikomo cha matumizi kwa akaunti na ufuatilie.'),
    ],
  },
  {
    id: 'reports',
    chapter: 'books',
    icon: 'reports',
    path: 'Books › Reports',
    view: 'Reports',
    target: '[data-tour="reports-overview"]',
    title: { en: 'Reports: the bigger picture', sw: 'Reports: picha kubwa' },
    body: {
      en: 'Reports read your records and sum them up. You do not build them yourself. Choose a report and a period. There is also a general ledger and a VAT summary.',
      sw: 'Ripoti husoma rekodi zako na kuzijumlisha. Huhitaji kuzitengeneza mwenyewe. Chagua ripoti na kipindi. Kuna pia general ledger na muhtasari wa VAT.',
    },
    points: [
      point('Profit and loss', 'Sales, minus the cost of goods and expenses, gives your profit.', 'Profit and loss', 'Mauzo, ukitoa gharama za bidhaa na matumizi, yanakupa faida.'),
      point('Balance sheet', 'What the business owns, what it owes, and what is left for the owners.', 'Balance sheet', 'Biashara inachomiliki, inachodaiwa, na kinachobaki kwa wamiliki.'),
      point('Cash flow statement', 'Where cash came from and where it went.', 'Cash flow statement', 'Fedha zilikotoka na zilikoenda.'),
      point('Receivables by age', 'Which customers are late, grouped by how many days.', 'Receivables by age', 'Wateja waliochelewa, wakigawanywa kwa idadi ya siku.'),
      point('Trial balance', 'A check that the debit and credit totals agree.', 'Trial balance', 'Ukaguzi kwamba jumla za debit na credit zinakubaliana.'),
    ],
  },
  {
    id: 'tax',
    chapter: 'books',
    icon: 'tax',
    path: 'Books › Tax',
    view: 'Tax',
    target: '[data-tour="tax-overview"]',
    title: { en: 'Tax: VAT and KRA deadlines', sw: 'Tax: VAT na tarehe za KRA' },
    body: {
      en: 'VAT is a tax added to sales. You collect it from customers and pass it to KRA, less the VAT you paid on business purchases. This page shows that sum for the month.',
      sw: 'VAT ni kodi inayoongezwa kwenye mauzo. Unaikusanya kutoka kwa wateja na kuipeleka KRA, ukitoa VAT uliyolipa kwenye manunuzi ya biashara. Ukurasa huu unaonyesha jumla hiyo kwa mwezi.',
    },
    points: [
      point('VAT this month', 'VAT charged on sales, VAT paid on purchases, and the net amount due to KRA.', 'VAT this month', 'VAT iliyotozwa kwenye mauzo, VAT iliyolipwa kwenye manunuzi, na kiasi halisi cha kulipa KRA.'),
      point('eTIMS', 'KRA’s system for signing invoices. Ledger Link queues each invoice but cannot submit it yet.', 'eTIMS', 'Mfumo wa KRA wa kusaini ankara. Ledger Link inaweka kila ankara kwenye foleni lakini haiwezi kuiwasilisha bado.'),
      point('Filing calendar', 'The dates returns are due. A weekend deadline moves to the next working day.', 'Filing calendar', 'Tarehe za kuwasilisha marejesho. Tarehe ya mwisho ikiangukia wikendi huhamia siku ya kazi inayofuata.'),
    ],
  },
  {
    id: 'payroll',
    chapter: 'books',
    icon: 'payroll',
    path: 'Books › Payroll',
    view: 'Payroll',
    target: '[data-tour="payroll-overview"]',
    title: { en: 'Payroll: pay your staff correctly', sw: 'Payroll: lipa wafanyakazi wako ipasavyo' },
    body: {
      en: 'Payroll means paying employees their salaries. The law takes some deductions from each salary, and you pay those to the agencies. Ledger Link works them out from the gross salary.',
      sw: 'Payroll ni kuwalipa wafanyakazi mishahara yao. Sheria inataka makato fulani kutoka kwa kila mshahara, nawe unayapeleka kwa mashirika husika. Ledger Link inayakokotoa kutoka mshahara ghafi.',
    },
    points: [
      point('Employees', 'Add each person with their KRA PIN and salary.', 'Employees', 'Ongeza kila mtu na KRA PIN na mshahara wake.'),
      point('Run payroll', 'Preview the month, then post the pay run to the books. Each person gets a payslip.', 'Run payroll', 'Angalia hesabu ya mwezi, kisha weka malipo kwenye vitabu. Kila mtu anapata payslip.'),
      point('The four deductions', 'PAYE is income tax. NSSF is pension. SHIF is health cover. The Housing Levy funds affordable housing.', 'Makato manne', 'PAYE ni kodi ya mapato. NSSF ni pensheni. SHIF ni bima ya afya. Housing Levy ni ushuru wa nyumba za bei nafuu.'),
      point('Statutory filings', 'Shows what each agency is owed and by when.', 'Statutory filings', 'Inaonyesha kila shirika linadai kiasi gani na kufikia lini.'),
    ],
  },
  {
    id: 'inventory',
    chapter: 'books',
    icon: 'inventory',
    path: 'Books › Inventory',
    view: 'Inventory',
    target: '[data-tour="inventory-overview"]',
    title: { en: 'Inventory: track what you stock', sw: 'Inventory: fuatilia bidhaa ulizo nazo' },
    body: {
      en: 'Inventory is the goods you keep to sell. Record each item with its cost and its selling price, and Ledger Link shows what your stock is worth.',
      sw: 'Inventory ni bidhaa unazoweka kwa ajili ya kuuza. Rekodi kila bidhaa na gharama na bei yake ya kuuzia, kisha Ledger Link inaonyesha thamani ya bidhaa zako.',
    },
    points: [
      point('Stock items', 'Name, code, quantity, cost and selling price.', 'Stock items', 'Jina, msimbo, idadi, gharama na bei ya kuuzia.'),
      point('Below reorder point', 'Set a reorder point on an item and it appears here when stock falls to that level.', 'Below reorder point', 'Weka kiwango cha kuagiza tena kwenye bidhaa, nayo itaonekana hapa stoku ikifikia kiwango hicho.'),
      point('Optional', 'A business that sells only services can ignore this page.', 'Si lazima', 'Biashara inayouza huduma pekee inaweza kupuuza ukurasa huu.'),
    ],
  },
  {
    id: 'projects',
    chapter: 'books',
    icon: 'projects',
    path: 'Books › Projects',
    view: 'Projects',
    target: '[data-tour="projects-overview"]',
    title: { en: 'Projects: track each job', sw: 'Projects: fuatilia kila kazi' },
    body: {
      en: 'A project is a job you want to measure on its own, such as fitting out a shop. Open a project, give it a budget, and see what it has cost so far.',
      sw: 'Mradi ni kazi unayotaka kuipima peke yake, kama kupamba duka. Fungua mradi, uupe bajeti, kisha uone umegharimu kiasi gani hadi sasa.',
    },
    points: [
      point('Budget and cost', 'The amount planned against the amount spent.', 'Budget and cost', 'Kiasi kilichopangwa dhidi ya kilichotumika.'),
      point('Hours logged', 'Time your team spent on each project.', 'Hours logged', 'Muda ambao timu yako imetumia kwa kila mradi.'),
      point('Optional', 'Skip this page if you do not track jobs separately.', 'Si lazima', 'Ruka ukurasa huu kama hufuatilii kazi kando kando.'),
    ],
  },

  // ── Office ────────────────────────────────────────────────────────────────
  {
    id: 'feed',
    chapter: 'office',
    icon: 'feed',
    path: 'Office › Business feed',
    view: 'Business Feed',
    target: '[data-tour="feed-overview"]',
    title: { en: 'Business feed: ask in plain words', sw: 'Business feed: uliza kwa maneno rahisi' },
    body: {
      en: 'Type a question about your business, such as how much profit you made this quarter. Gemini, an AI service, writes the answer from your posted figures. It can be wrong, so check any figure in Reports before you act on it.',
      sw: 'Andika swali kuhusu biashara yako, kama faida uliyopata robo hii. Gemini, huduma ya AI, inaandika jibu kutoka takwimu zako zilizowekwa. Inaweza kukosea, kwa hiyo kagua takwimu yoyote kwenye Reports kabla ya kuchukua hatua.',
    },
  },
  {
    id: 'team',
    chapter: 'office',
    icon: 'team',
    path: 'Office › Team',
    view: 'Team',
    target: '[data-tour="team-overview"]',
    title: { en: 'Team: who can open your books', sw: 'Team: nani anaweza kufungua vitabu vyako' },
    body: {
      en: 'Invite an accountant or a colleague by email. Each person has a role that decides what they may change.',
      sw: 'Mwalike mhasibu au mwenzako kwa barua pepe. Kila mtu ana jukumu linaloamua anachoweza kubadilisha.',
    },
    points: [
      point('Owner', 'Holds the organization and posts to the books.', 'Owner', 'Anamiliki shirika na anaweka rekodi kwenye vitabu.'),
      point('Admin', 'Posts to the books, invites members and changes settings.', 'Admin', 'Anaweka rekodi kwenye vitabu, anaalika wanachama na kubadilisha mipangilio.'),
      point('Member', 'Can read the books. Posting needs an owner or an admin.', 'Member', 'Anaweza kusoma vitabu. Kuweka rekodi kunahitaji mmiliki au msimamizi.'),
    ],
  },
  {
    id: 'integrations',
    chapter: 'office',
    icon: 'plug',
    path: 'Office › Integrations',
    view: 'Apps / Integrations',
    target: '[data-tour="apps-overview"]',
    title: { en: 'Integrations: other services', sw: 'Integrations: huduma nyingine' },
    body: {
      en: 'This page lists services Ledger Link could connect to, such as M-Pesa Business and KRA eTIMS. Only the eTIMS queue exists today. The others are planned, each card says so, and none can be switched on yet.',
      sw: 'Ukurasa huu unaorodhesha huduma ambazo Ledger Link inaweza kuunganishwa nazo, kama M-Pesa Business na KRA eTIMS. Foleni ya eTIMS pekee ipo leo. Nyingine zimepangwa, kila kadi inasema hivyo, na hakuna inayoweza kuwashwa bado.',
    },
  },
  {
    id: 'audit',
    chapter: 'office',
    icon: 'audit',
    path: 'Office › Audit log',
    view: 'Audit Logs',
    target: '[data-tour="audit-overview"]',
    title: { en: 'Audit log: who changed what', sw: 'Audit log: nani alibadilisha nini' },
    body: {
      en: 'Every change to accounts, entries and the team is written here, in the order it happened. Entries cannot be edited or removed, so you can always trace a change. You can export the log as a CSV file.',
      sw: 'Kila badiliko la akaunti, rekodi na timu linaandikwa hapa, kwa mpangilio lilivyotokea. Rekodi haziwezi kuhaririwa wala kufutwa, kwa hiyo unaweza kufuatilia badiliko lolote. Unaweza kusafirisha kumbukumbu kama faili la CSV.',
    },
  },
  {
    id: 'settings',
    chapter: 'office',
    icon: 'settings',
    path: 'Office › Settings',
    view: 'Settings',
    target: '[data-tour="settings-overview"]',
    title: { en: 'Settings: your business details', sw: 'Settings: maelezo ya biashara yako' },
    body: {
      en: 'Set up the business itself here. You can keep several businesses and switch between them from the top of the page.',
      sw: 'Weka mipangilio ya biashara yenyewe hapa. Unaweza kuwa na biashara kadhaa na kubadilisha kati yake kutoka juu ya ukurasa.',
    },
    points: [
      point('Companies', 'Your business name, country and base currency.', 'Companies', 'Jina la biashara, nchi na sarafu kuu.'),
      point('Currencies', 'Exchange rates for foreign invoices and bills.', 'Currencies', 'Viwango vya kubadilisha fedha kwa ankara na bili za nje.'),
      point('Posting accounts', 'The accounts Ledger Link uses when it posts an invoice or a bill.', 'Posting accounts', 'Akaunti ambazo Ledger Link inatumia inapoweka ankara au bili.'),
      point('Security and export', 'Sign-in safety, and a CSV copy of your general ledger.', 'Security and export', 'Usalama wa kuingia, na nakala ya CSV ya general ledger yako.'),
    ],
  },
  {
    id: 'documentation',
    chapter: 'office',
    icon: 'help',
    path: 'Office › Documentation',
    view: 'Documentation',
    target: '[data-tour="documentation-overview"]',
    title: { en: 'Documentation: answers and guided work', sw: 'Documentation: majibu na mwongozo wa kazi' },
    body: {
      en: 'Use this page when you need a full tutorial, a plain-language answer, or a technical troubleshooting checklist. Search by task, error code or feature.',
      sw: 'Tumia ukurasa huu unapohitaji mafunzo kamili, jibu rahisi au orodha ya ukaguzi wa tatizo la kiufundi. Tafuta kwa kazi, msimbo wa hitilafu au kipengele.',
    },
    points: [
      point('Business tutorials', 'Exact steps for invoices, bills, banking, reports, payroll and more.', 'Business tutorials', 'Hatua kamili za ankara, bili, benki, ripoti, mishahara na mengine.'),
      point('Technical operations', 'Architecture, API, database, deployment and security runbooks.', 'Technical operations', 'Miongozo ya usanifu, API, hifadhidata, usambazaji na usalama.'),
      point('Troubleshooting', 'Symptoms, checks and safe fixes without blind retries.', 'Troubleshooting', 'Dalili, ukaguzi na marekebisho salama bila kujaribu tena bila uhakika.'),
    ],
  },

  // ── Finish ────────────────────────────────────────────────────────────────
  {
    id: 'help',
    chapter: 'finish',
    icon: 'help',
    path: 'Office › Settings',
    view: 'Settings',
    target: '[data-tour="restart-tutorial"]',
    title: { en: 'Help is always here', sw: 'Msaada unapatikana hapa kila wakati' },
    body: {
      en: 'Come back to this section whenever you want to run the tutorial again. Restarting it never changes your business data.',
      sw: 'Rudi kwenye sehemu hii wakati wowote unapotaka kuanza mafunzo tena. Kuyaanzisha upya hakubadilishi data ya biashara yako.',
    },
  },
  {
    id: 'done',
    chapter: 'finish',
    icon: 'done',
    title: { en: 'You are ready to start', sw: 'Uko tayari kuanza' },
    body: {
      en: 'A good first week looks like this. Take one step at a time.',
      sw: 'Wiki nzuri ya kwanza inaonekana hivi. Chukua hatua moja baada ya nyingine.',
    },
    points: [
      point('1', 'Add a customer in Customers.', '1', 'Ongeza mteja kwenye Customers.'),
      point('2', 'Write an invoice in Sales.', '2', 'Andika ankara kwenye Sales.'),
      point('3', 'When they pay, record the payment on the invoice.', '3', 'Wakilipa, rekodi malipo kwenye ankara.'),
      point('4', 'Match your bank lines in Banking.', '4', 'Linganisha miamala ya benki kwenye Banking.'),
      point('5', 'Read your Profit and loss in Reports.', '5', 'Soma Profit and loss yako kwenye Reports.'),
    ],
  },
];

/** Highest step index the API accepts (see onboardingSchema in worker/index.ts). */
export const MAX_TOUR_STEPS = 51;
