# Kenyan / East African / African SME Accounting Competitors and Payment & Banking Rails (as of Oct 2026)

> Method note for the report writer: research was done 1 Oct 2026. The session's WebFetch was blocked by the egress proxy for almost every domain (kra.go.ke, techcabal.com, developers.facebook.com, tech-ish.com, fnjassociates.co.ke, respond.io, glama.ai, etc.), and the shared web-search budget ran out partway through. **Every finding below comes from search-result summaries, not from full page reads.** Figures that came from vendor, reseller or SEO blogs are marked "(secondary)" or "(self-described)". Anything dated before 2025 is marked "[older]".

## 1. Which accounting / bookkeeping / invoicing / POS products do Kenyan SMEs use, what do they charge, and which are eTIMS-certified?

### Takeaway
The Kenyan SME accounting market splits three ways:
- **Global SaaS with Kenyan localisation.** Zoho Books has a KES-priced Kenya edition, is a KRA-approved eTIMS integrator, and has a free tier with paid plans from KSh 849–999 per month. Odoo ships native OSCU modules. QuickBooks, which employers ask for most, has **no native eTIMS** and depends on third-party middleware such as DigiTax.
- **Legacy desktop and ERP tools** (Sage 50/Pastel, Tally, BUSY, ERPNext). These reach eTIMS through certified integrators such as Advatech for Sage and Navari or Slade for ERPNext.
- **A crowded set of new local "eTIMS + M-Pesa" startups** (ZYNO Books, Qwan, LedgerFlow, Veira, Cute Profit, plus Uhasibu since 2010). They all make the same claims Ledger Link plans to make, and none has verified traction.

eTIMS is now essential for every product here. From 1 Jan 2026 KRA cross-checks income-tax returns against eTIMS data, so an expense with no eTIMS invoice behind it puts the deduction at risk.

### Cited Findings
**eTIMS regulation (what all products must support)**
- KRA publishes a running "List of Approved eTIMS 3rd party integrators". The most recent version found is dated **26 January 2026**. Earlier versions: 10 Nov 2023, 12 Jun 2024, 6 Nov 2024. — [KRA list, 26 Jan 2026](https://www.kra.go.ke/images/publications/List-of-Approved-eTIMS-3rd-party-integrators-as-at-26th-January-2026.pdf); [KRA list, 6 Nov 2024](https://kra.go.ke/images/publications/List-of-Approved-eTIMS-3rd-party-integrators-as-at-6th-Nov-2024.pdf)
- Example entries on the Jan 2026 list (from the search summary; the PDF itself could not be opened):
  - Advatech Office Supplies Ltd: AdvaPOS and AdvaMauzo (OSCU); AdvaPOS and **Sage** (VSCU); Adva Forecourt (VSCU, fuel stations).
  - Stanbest Group (EA): iSale POS (OSCU + VSCU).
  - Dejavu Technologies: Comstore POS (OSCU + VSCU).
  - Rhenium Group: Injonge eTIMS POS (OSCU + VSCU).
  - — [KRA list, 26 Jan 2026](https://www.kra.go.ke/images/publications/List-of-Approved-eTIMS-3rd-party-integrators-as-at-26th-January-2026.pdf)
- **Sage 50 (versions 50/100/200/300)** appears as an approved eTIMS integration through **Advatech Office Supplies** (etims@advatech.co.ke). — [KRA list, Nov 2024](https://kra.go.ke/images/publications/List-of-Approved-eTIMS-3rd-party-integrators-as-at-6th-Nov-2024.pdf) [older]
- Greytrix sells an e-invoicing (eTIMS) add-on for Sage ERP in Kenya and published a "2026 compliance" guide. — [Greytrix](https://www.greytrix.com/africa/product/other-solutions/e-invoicing-solutions/e-invoicing-for-sage-erp-kenya/); [Greytrix 2026 guide](https://www.greytrix.com/africa/integrating-e-invoices-with-erp-in-kenya-a-strategic-guide-for-2026-compliance/)
- **From 1 Jan 2026, KRA validates income and expenses declared in income-tax returns** against eTIMS data, withholding-tax certificates and customs import records. — [EY Tax News, 11 Dec 2025](https://taxnews.ey.com/news/2025-2471-kenya-revenue-authority-to-validate-income-and-expenses-in-income-tax-returns); [BDO EA](https://www.bdo-ea.com/en-gb/insights/kra-to-validate-income-and-expenses-declared-in-tax-returns-effective-1-january-2026)
- The **Finance Act 2023** amended the Income Tax Act so that an expense is not deductible unless its invoice was generated through eTIMS, subject to the exemptions in s.23A of the Tax Procedures Act.
  - Exempt items: salaries/PAYE, imports, financial-institution charges and insurance premiums, final-WHT items, airline tickets, internal accounting adjustments, investment allowances, and anything else the Commissioner exempts.
  - Each invoice must carry the buyer's PIN where applicable.
  - — [EY Tax News](https://taxnews.ey.com/news/2025-2471); [BDO EA](https://www.bdo-ea.com/en-gb/insights/kra-to-validate-income-and-expenses-declared-in-tax-returns-effective-1-january-2026)
- The EastAfrican reported that a "'Mama Mboga' invoice [is] now valid for income deductible". This points to buyer-initiated or simplified eTIMS invoices for informal suppliers; only the headline was available. — [The EastAfrican](https://theeastafrican.co.ke/tea/business-tech/mama-mboga-invoice-now-valid-for-income-deductible-5467706)
- KRA offers eTIMS free of charge in several forms: an online portal, the eTIMS Client software, USSD, eCitizen, and the **eTIMS Lite mobile app** for MSMEs.
  - Hardware is a separate cost: about KSh 5,000 for a basic thermal printer and KSh 40,000–70,000 for a full POS.
  - System-to-system integration is the paid route for high-volume businesses.
  - — [FaidiHR (secondary)](https://faidihr.com/blog/how-much-is-etims-in-kenya); [Kenyans.co.ke](https://www.kenyans.co.ke/featured/101195-how-assess-what-etims-solution-use-your-business)
- KPMG Kenya published a 2026 eTIMS thought-leadership PDF; only its existence was confirmed. — [KPMG 2026 eTIMS PDF](https://assets.kpmg.com/content/dam/kpmgsites/ke/pdf/thought_leaderships/tax/2026/eTIMS.pdf.coredownload.inline.pdf)

**Zoho Books (Kenya edition)**
- Zoho describes Zoho Books Kenya as a "KRA approved eTIMS integrator". — [Zoho KE eTIMS page](https://www.zoho.com/ke/books/etims-compliance)
- Zoho launched a VAT/TIMS-compliant Kenya edition in **Sept 2022**. — [HapaKenya 2022](https://hapakenya.com/2022/09/29/zoho-launches-vat-tims-compliant-accounting-software-in-kenya) [older]
- KES pricing "as of August 2026", per organisation per month. This comes from a Zoho implementation partner (secondary); 14-day trial.

  | Plan | Monthly billing | Annual billing (per month) |
  |---|---|---|
  | Free | KSh 0 | KSh 0 |
  | Standard | KSh 999 | KSh 849 |
  | Professional | KSh 1,999 | KSh 1,699 |
  | Premium | KSh 2,999 | KSh 2,499 |
  | Elite | KSh 9,000 | KSh 7,500 |
  | Ultimate | KSh 18,000 | KSh 15,000 |

  — [FNJ Associates, Zoho Books in Kenya 2026 guide](https://fnjassociates.co.ke/?p=2755)

**QuickBooks Online**
- Intuit's community answer: Kenyan users should look for an "eTIMS" app in the QBO apps marketplace. If none is listed, QBO has **no direct support** and users must go to eTIMS support or a third party. — [QuickBooks Community](https://quickbooks.intuit.com/community/other-questions-88/etims-invoicing-kenya-376172)
- **DigiTax** (Namiri Technology Ltd) provides system-to-system eTIMS integration for Odoo, WooCommerce and **QuickBooks**, plus a web dashboard and an Android POS app. Pricing was not found. — [Capital FM](https://capitalfm.africa/digitax-revolutionizes-etims-tax-compliance-with-enhanced-system-to-system-integration-features-capabilities/); [The Star, Mar 2024](https://www.the-star.co.ke/sasa/technology/2024-03-04-tech-firm-revolutionises-etims-tax-compliance-with-system-to-system-integration); [Mwango Weekly, May 2025](https://mwangocapital.substack.com/p/23-05-2025-digitax-simplifying-etims-compliance)
- QuickBooks pricing is in USD. US Simple Start is quoted at about **$38/month** in 2026. No Kenya KES price list was found. — [NerdWallet 2026](https://www.nerdwallet.com/article/small-business/quickbooks-pricing)
- Kenyan staffing firms say employers prefer candidates with QuickBooks skills. This suggests QuickBooks is widely installed among formal SMEs. — [Corporate Staffing, Jul 2026](https://www.corporatestaffing.co.ke/2026/07/5-main-reasons-why-kenyan-employers-prefer-candidates-with-quickbooks-skills/)

**Odoo and ERPNext**
- The Odoo Kenya localisation auto-installs four modules:
  - `l10n_ke` (accounting)
  - `l10n_ke_reports`
  - `l10n_ke_edi_oscu` (**eTIMS OSCU integration**)
  - `l10n_ke_edi_oscu_mrp` (manufacturing)
- Optional Odoo modules: `l10n_ke_edi_oscu_pos` (POS eTIMS) and a Tremol G03 control-unit integration. Odoo describes its OSCU as one that "validates, encrypts, signs, transmits and stores" invoices. — [Odoo 18 docs](https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations/kenya.html); [Odoo 20 docs](https://www.odoo.com/documentation/20.0/applications/finance/fiscal_localizations/kenya.html)
- ERPNext / Frappe:
  - **Navari Ltd** publishes an open-source `kenya-compliance` app (eTIMS via OSCU).
  - The Frappe Cloud marketplace also lists "kenya_compliance_via_slade" and "csf_ke".
  - Ecosire sells an ERPNext Kenya KRA eTIMS app.
  - — [Navari GitHub project](https://awesome.ecosyste.ms/api/v1/projects/github.com%2Fnavariltd%2Fkenya-compliance); [Frappe marketplace, via Slade](https://cloud.frappe.io/marketplace/apps/kenya_compliance_via_slade); [Frappe marketplace, csf_ke](https://cloud.frappe.io/marketplace/apps/csf_ke); [Ecosire](https://docs.ecosire.com/erpnext-apps/erpnext-kenya-kra-etims)

**Tally, BUSY and Sage Pastel**
- Tally Solutions publishes Kenya eTIMS registration and integration guides for its Sub-Saharan Africa (SSA) market. Pricing was not found. — [Tally eTIMS integration](https://tallysolutions.com/ssa/tally/etims-integration-with-accounting-systems); [Tally eTIMS registration guide](https://tallysolutions.com/ssa/tally/etims-registration-compliance-requirements-guide)
- BUSY (India) markets "accounting software in Kenya"; Sage Pastel and eZee also appear in Kenyan comparisons. — [BUSY](https://busy.in/international/accounting-software-in-kenya.md)

**Local Kenyan SME accounting startups (all self-described; no traction data found)**

| Product | What it claims | Source |
|---|---|---|
| **ZYNO Books** | "Kenya's #1 cloud accounting software", built-in eTIMS and M-Pesa Paybill integration (marketing claim on its own WordPress blog, Apr 2026) | [ZYNO blog](https://zynobooks.wordpress.com/2026/04/15/best-etims-compliant-cloud-accounting-software-in-kenya-with-m-pesa-for-smes/) |
| **Qwan** | Combines local compliance, **M-Pesa payment links** and "AI intelligence" in one subscription (from its own blog) | [Qwan blog](https://qwan-accounting.com/blog/article2-best-accounting-software-kenya.html) |
| **Uhasibu** | Serving SMEs **since 2010**; KRA VAT, M-Pesa Paybill reconciliation, invoicing, petty cash (as reported by a competitor's blog) | [EliteMindz](https://elitemindz.co/blog/best-cloud-accounting-software-kenya-mpesa-etims) |
| **Cute Profit** | Kenyan POS plus accounting ERP with eTIMS and automatic M-Pesa matching | [Cute Profit](https://www.cuteprofit.com/online-accounting-software-kenya) |
| **LedgerFlow** (Medici Africa) | "Accounting, tax & eTIMS"; M-Pesa reconciliation and AI bookkeeping | [LedgerFlow](https://ledgerflow.medici.africa/) |
| **Veira** | ERP for SMEs: POS, inventory, accounting, payroll and eTIMS with M-Pesa; "live same day" | [Veira](https://veirahq.com/blog/erp-software-kenya) |
| **EliteMindz** | Publishes "best accounting software Kenya 2026" listicles (likely a competitor or reseller) | [EliteMindz](https://elitemindz.co/blog/best-accounting-software-kenya) |

**Market context**
- A Kenyan article says about **5.8 million Kenyan MSMEs still run on spreadsheets**. It cites the CBK 2024 *Survey Report on MSME Access to Bank Credit*, which names poor record-keeping as a main barrier to formal credit: when banks cannot verify revenue from accounting software, they ask for collateral. — [Streamline Feed (secondary)](https://streamlinefeed.co.ke/news/why-kenyan-msmes-still-run-on-spreadsheets)

### Inferences
- **eTIMS is now table stakes.** Zoho (free tier plus KRA approval), Odoo (native OSCU) and at least six local startups already advertise "eTIMS + M-Pesa reconciliation". Ledger Link needs a different headline.
- Possible differentiators, based on gaps the competitors are not seen to cover:
  - **Live M-Pesa sync**, using Daraja C2B plus the Pull Transactions API rather than CSV uploads.
  - **Purchase-side eTIMS validation.** Flag supplier bills that lack a valid eTIMS invoice before year-end, because the 2026 expense validation makes this a real tax risk.
  - **Sector packs** for SACCOs and NGOs. None of the competitors found target these.
  - **Kenyan payroll** (SHIF and Housing Levy) bundled with accounting. Zoho needs a separate Zoho Payroll; local tools vary.
- **Price anchor:** Zoho's free tier and roughly KSh 850–2,500 per month for small businesses set the expected price. A Ledger Link SME tier much above KSh 2,500 per month needs clear extra value, such as payroll plus eTIMS plus live M-Pesa.
- **Certification:** Ledger Link should get onto the KRA approved-integrator list as an OSCU (or VSCU) integrator. The list is a public trust signal and appears to be a buying filter for accountants. Getting listed through an existing integrator partnership is a faster route, the same way Sage uses Advatech.
- **QuickBooks users are an acquisition opportunity.** QBO lacks native eTIMS and is priced in USD, so its users are switchable. A "QuickBooks → Ledger Link" migrator (CoA, customers, open invoices) could be valuable.

### Gaps
- The full KRA Jan 2026 integrator list (exact count, and whether Zoho, Odoo, QuickBooks or Xero entries are listed as OSCU or VSCU) could not be retrieved; the PDF was blocked.
- No reliable traction numbers were found (user counts, revenue, funding) for any local Kenyan accounting startup, or for Zoho or QuickBooks in Kenya.
- No KES pricing was found for QuickBooks via Kenyan resellers, Sage 50/Pastel Kenya, Tally Kenya, Uhasibu, Vyapar Kenya, Khatabook, or the local startups.
- Not researched because the search budget ran out: Xero's Kenya eTIMS position, and Vyapar/Khatabook-style ledgers in Kenya.
- No Kenya-specific survey of accounting-software market share was found.

## 2. African fintech / SME-ops players with accounting-adjacent features — what can be learned?

### Takeaway
The successful pattern is **payments plus credit plus "business-in-a-box"**, with bookkeeping as a feature rather than the product:
- Moniepoint entered Kenya in 2025–26 through a microfinance-bank acquisition.
- Bumpa entered Kenya in June 2026 with WhatsApp commerce, M-Pesa and bookkeeping.
- Safaricom itself now offers Fuliza Biashara and Taasi loans on the till.

Standalone bookkeeping apps, and fintechs that borrowed in USD to lend in shillings, have failed: Kippa (bookkeeping app inaccessible since Jan 2024), Lipa Later (in administration since Mar 2025) and Okra (shut down 2025).

### Cited Findings
**Moniepoint (Nigeria → Kenya)**
- Acquired a **78% stake in Sumac Microfinance Bank**; the Competition Authority of Kenya approved it in **June 2025**. This gives Moniepoint a deposit-taking licence. — [FinTech Futures](https://www.fintechfutures.com/m-a/moniepoint-enters-kenyan-market-with-sumac-microfinance-bank-acquisition); [ITWeb Africa](https://itweb.africa/article/moniepoint-hits-new-shores-in-kenya/KzQenvjywW6qZd2r)
- Plans a **"business-in-a-box"** for Kenya that combines Orda's technology with Sumac's banking: inventory management, payroll and working-capital finance. It cites an IFC estimate of a **$19bn Kenyan SME credit gap**. — [Daba Finance](https://dabafinance.com/en/news/moniepoint-kenya-expansion)
- Former Branch Kenya CEO **Rose Muturi** leads Moniepoint's Kenya strategy. — [ITWeb Africa](https://itweb.africa/article/moniepoint-hits-new-shores-in-kenya/KzQenvjywW6qZd2r)

**Bumpa (Nigeria → Kenya, June 2026)**
- Entered Kenya in **June 2026**, its first East African market.
- Records online and offline sales, builds storefronts, and **receives payments via M-Pesa**.
- Serves **more than 136,000 businesses across Nigeria and Kenya**.
- Combines a store with inventory, payments, **bookkeeping**, customer management and delivery integrations.
- Plans Meta integration: one inbox for WhatsApp, Instagram and Facebook, plus **issuing invoices and requesting payments** from inside the platform.
- — [Capital FM, Jun 2026](https://www.capitalfm.co.ke/business/2026/06/bumpa-enters-kenya-to-tap-growing-sme-digital-commerce-market/); [AllAfrica](https://allafrica.com/stories/202606120047.html); [Business Today](https://businesstoday.co.ke/nigerias-king-of-social-commerce-bumpa-invades-kenyas-software-market/)

**Chpter (Kenya)**
- Kenyan conversational-commerce startup founded in 2022; raised a **$1.2m pre-seed**. — [Africa Private Equity News](https://www.africaprivateequitynews.com/p/kenya-social-commerce-platform-chpter)
- Its API turns social likes and comments into sales. — [TechCabal, Mar 2025](https://techcabal.com/2025/03/04/chpter-api-turns-likes-and-comments-into-sales/)
- Spun off **Pluto**, a WhatsApp API suite for automating customer conversations and transactions, as a subsidiary in **2025**. — [TechCabal, Apr 2025](https://techcabal.com/2025/04/02/chpter-spins-off-pluto-as-subsidiary/)
- In typical Kenyan WhatsApp commerce today, the buyer pastes the M-Pesa confirmation into the chat and the seller confirms by hand. — [TechTrends KE, Mar 2026](https://techtrendske.co.ke/2026/03/11/africa-whatsapp-commerce/)

**Kippa (Nigeria): cautionary tale**
- Launched in 2021 to digitise SME bookkeeping. Added KippaPay agency banking, then shut it in **Oct 2023** after naira devaluation made POS terminals unaffordable; 40 staff were laid off. — [TechCabal, Feb 2024](https://techcabal.com/2024/02/01/exclusive-kippa-cofounder-duke-ekezie-exits-after-agency-banking-shutdown-embarks-on-new-venture/) [older]
- Pivoted to edtech in Jan 2024. **The bookkeeping app has been inaccessible since Jan 2024, leaving merchants unable to reach their inventory, debtor, transaction and invoice data.** — [TechCabal, Feb 2024](https://techcabal.com/2024/02/23/kippa-users-left-in-the-dark/)
- By Aug 2025 the founders had left and the website was down; Kippa had raised **more than $14m**. — [Launch Base Africa, Aug 2025](https://launchbaseafrica.com/2025/08/18/founders-exit-website-down-the-unraveling-of-target-global-backed-kippa-that-raised-over-14m/)

**Payment gateways and aggregators (Kenya pricing)**

| Provider | M-Pesa collection fee | Other fees and features | Source |
|---|---|---|---|
| **Paystack Kenya** | **1.5%** | Local card 2.9%, international card 3.8%; no monthly fee; T+2 settlement to bank or M-Pesa; M-Pesa payouts KES 20–60; USD settlement possible | [Paystack KE pricing](https://paystack.com/ke/pricing) |
| **Flutterwave** | About **2.9%** (2.9–3.5%) | Was seeking a CBK PSP licence after its court battles ended | [PeopleDaily](https://peopledaily.digital/business/flutterwave-starts-search-for-central-bank-permit-after-end-of-court-battles); [LearnWithHasan (secondary)](https://learnwithhasan.com/payment-gateways/flutterwave/) [licence status older] |
| **Pesapal** | About **3–3.5%** | Cards 3.5% | [PaybillKE (secondary)](https://paybillke.com/guides/mpesa-payment-gateway-kenya-2026) |
| **IntaSend** | **1%** (STK and Paybill) | Local card 3.5%, international 4.5%; mobile payouts KES 10–50; **PesaLink payouts KES 100–500** depending on band; no monthly fees | [IntaSend support](https://support.intasend.com/portal/en/kb/articles/how-do-you-charge-for-the-service); [IntaSend](https://intasend.com/payments/merchant-payment-solutions-for-businesses-in-kenya) |
| **Kopo Kopo** | **0.55%, capped at KSh 200**; free under KSh 200 | **K2 Connect** APIs/SDKs to plug payments into accounting packages and POS; WooCommerce plugin live, with Shopify, Wix, Ecwid and **Odoo** "coming soon"; offers merchant loans | [Kopo Kopo](https://kopokopo.co.ke/?p=3067); [K2 Connect](https://kopokopo.co.ke/introducing-k2connect/); [Kopo Kopo developers](https://kopokopo.co.ke/developers/) |

- Kopo Kopo's rate mirrors Safaricom's Buy Goods tariff and may predate the Aug 2026 tariff change.
- **Cellulant / Tingg** [older, ~2023]:
  - Laid off 20% of staff, after cutting about 30% six months earlier.
  - Aimed to open Tingg to small merchants, growing from about 1,000 to 50,000 merchants.
  - Partnered with PesaLink to scale bank-account C2B payments.
  - — [TechEconomy](https://techeconomy.ng/cellulant-to-lay-off-20-of-its-workforce); [African Mirror](https://theafricanmirror.africa/science-tech-and-innovation/kenyas-cellulant-targets-50000-new-merchants-boosts-war-chest/)

**Credit and BNPL**
- **Lipa Later** (Kenyan BNPL) went into **administration on 24 Mar 2025**.
  - It had raised $12m equity (2022) and $3.4m debt (2023).
  - It borrowed in USD and earned in KES; the shilling's slide from about 100 to 170 per USD sharply raised its debt burden.
  - A planned deal with Nigeria's Klump fell through (Sept 2025).
  - — [TechCabal, Mar 2025](https://techcabal.com/2025/03/27/lipa-later-enters-administration/); [Launch Base Africa](https://launchbaseafrica.com/2025/03/27/from-debts-to-trade-secrets-theft-inside-the-collapse-of-kenyan-bnpl-startup-lipa-later/); [TechCabal, Sept 2025](https://techcabal.com/2025/09/26/inside-lipa-later-courtship-nigeria-klump/)
- **Safaricom's own SME stack:**
  - The **M-PESA for Business app** (separate from the consumer app) gives till and paybill owners real-time notifications, **full and exportable statements**, money-in/money-out charts, supplier and salary payments, and multi-till management. — [Google Play](https://play.google.com/store/apps/details?id=com.safaricom.mpesa.orgapp&hl=en); [Safaricom M-PESA Business Hub](https://www.safaricom.co.ke/main-mpesa/for-your-business/m-pesa-business-hub)
  - The **M-PESA Business Hub** promises cash-flow monitoring and "reconcile accounts easily". — [Safaricom M-PESA Business Hub](https://www.safaricom.co.ke/main-mpesa/for-your-business/m-pesa-business-hub)
  - Safaricom launched **Fuliza Biashara**, a business overdraft of up to **KES 400,000**, and **Taasi Till loans** of up to **KES 250,000**. — [Moses Kemibaro Substack](https://moseskemibaro.substack.com/p/m-pesa-is-eating-safaricom-the-launch); [Tech-ish M-PESA timeline](https://tech-ish.com/2026/03/25/m-pesa-2020-to-2026-timeline/)

**B2B e-commerce and open banking**
- **Wasoko + MaxAB** completed an all-stock merger in **Aug 2024**. The combined company serves more than 450,000 informal retailers in five markets: Egypt, Kenya, Morocco, Rwanda and Tanzania. The COMESA competition commission was investigating the merger as of Oct 2025. — [TechCabal, Aug 2024](https://techcabal.com/2024/08/27/wasoko-maxab-complete-merger/); [Techleap / COMESA](https://finder.techleap.nl/news/feed/wasoko-maxab-merger-under-comesa-investigation)
- **Okra** (Nigerian open banking) ceased trading around May 2025 and fully shut down in July 2025 after raising about $16m. Rivals **Mono** ($17.6m raised) and **Stitch** ($52m) outspent it. — [AllAfrica, Jul 2025](https://allafrica.com/stories/202507040471.html); [All Business Africa](https://allbusiness.africa/insights/african-open-banking-okra-collapse-2026)
- **Pngme** (data and credit infrastructure for banks and fintechs) was founded in 2018 and is based in Nairobi. — [CB Insights](https://www.cbinsights.com/compare/okra-vs-pngme)

### Inferences
- **Lessons for Ledger Link:**
  - Bookkeeping alone does not monetise in African SME markets. Winners pair it with payments, where they earn a take-rate, and with **lending on the books**. Ledger Link's double-entry ledger plus live M-Pesa data is exactly what a lender needs. A partnership offering "share verified books with a lender or SACCO" fits the CBK finding that poor records block credit.
  - **Data portability is a trust feature.** Kippa users lost their data when the app went dark. Ledger Link should advertise one-click full export (CSV/Excel and an accountant pack) and an escrow or continuity commitment.
  - **Bumpa now competes directly** in WhatsApp invoicing with M-Pesa for Kenyan social sellers. It is stronger on storefronts and inventory; Ledger Link should be stronger on double-entry, eTIMS, payroll and accountant workflows. Position Ledger Link as "real books for businesses that sell on WhatsApp", not as a storefront.
  - **Safaricom is the incumbent "free" competitor** for dukas: its business app already gives statements, charts and till loans. Ledger Link should *ingest* those statements rather than compete on payments UX.
- **Gateway choice for payment links:**
  - Direct Daraja has no gateway fee; only the Safaricom tariff applies.
  - Through aggregators: IntaSend 1%, Paystack 1.5%, Flutterwave/Pesapal about 3%.
  - Ledger Link could start through an aggregator for speed and to reach users without a Paybill, then offer direct Daraja for merchants who own a Paybill or Till.
  - (Partly assumption: Kopo Kopo's K2 Connect is the only aggregator found that explicitly targets accounting-package integration, which makes it a natural partner.)

### Gaps
- No 2025–26 data was found for Brass (Nigeria), Chipper Cash, Twiga Foods, Sky.Garden or Kippa's successors.
- No current Kenyan merchant count or revenue figures for Kopo Kopo, Pesapal or Cellulant.
- Bumpa's Kenyan pricing is unknown.
- No primary-source confirmation of Fuliza Biashara and Taasi terms (interest or fees).

## 3. M-Pesa Daraja APIs, statement formats, Till vs Paybill vs Pochi la Biashara, Airtel Money Kenya, aggregators

### Takeaway
- **Daraja 3.0 (launched 25 Nov 2025)** is a cloud-native rebuild: up to about 12,000 TPS, more than 105,000 developers and more than 66,000 integrations, and roughly 25% of M-Pesa volume. It adds Security, Mini-App and IoT APIs. Using the API is free; Safaricom's transaction tariffs still apply.
- For an accounting product, the key building blocks are:
  - **C2B Register URL** (real-time confirmation callbacks), plus the **Pull Transactions API**, which re-fetches a shortcode's C2B transactions for the last 48 hours to recover missed callbacks.
  - **Transaction Status** and **Account Balance**.
  - **STK Push** for payment links.
  - **Ratiba** for recurring collections.
- Going live still requires the merchant's own active Paybill or Till, a go-live letter and IP whitelisting.
- **Merchant tariffs fell in Aug 2026:** Buy Goods is now free up to KES 500, then 0.55% capped at KES 200. Business-to-wallet transfer fees were cut by up to about 50%.

### Cited Findings
**Daraja 3.0 (Nov 2025)**
- Cloud-native rebuild with "Fintech 2.0" positioning; supports up to 12,000 TPS, with a target of 10,000 TPS in Jan 2026. — [TechTrends KE](https://techtrendske.co.ke/2025/11/26/safaricom-targets-10000-m-pesa-tps-with-cloud-native-daraja-3-0-overhaul/); [Khusoko](https://khusoko.com/2025/11/26/safaricom-unveils-daraja-3-0-a-cloud‑native-m‑pesa-api-platform/)
- New in 3.0:
  - **Security APIs** for fraud detection and prevention and identity verification.
  - **Mini Apps** that run inside the M-PESA Super App.
  - **IoT APIs**.
  - AI-powered developer support and new documentation.
  - "More transparent governance" after years of developer complaints about go-live delays and gaps in the docs.
  - — [Khusoko](https://khusoko.com/2025/11/26/safaricom-unveils-daraja-3-0-a-cloud‑native-m‑pesa-api-platform/); [Techweez](https://techweez.com/2025/11/25/safaricom-daraja-3-fintech-platform-launch/); [Eastleigh Voice](https://eastleighvoice.co.ke/m-pesa-m-pesa%20app-safaricom/247168/safaricom-rolls-out-daraja-3-0-in-major-m-pesa-api-redesign)
- The ecosystem has **more than 66,000 integrations and more than 105,000 developers**. — [Khusoko](https://khusoko.com/2025/11/26/safaricom-unveils-daraja-3-0-a-cloud‑native-m‑pesa-api-platform/)
- **About 25% of all M-PESA transactions go through Daraja.** M-PESA handles more than 100m transactions a day and peaks at about 6,000 TPS. Safaricom framed the upgrade around faster onboarding. — [TechCabal, Nov 2025](https://techcabal.com/2025/11/25/safaricom-overhauls-m-pesa-api-platform/)
- There is no charge for Daraja API access, the sandbox or going live; transaction tariffs still apply. — [HelloDuty (secondary)](https://helloduty.com/blogs/what-is-a-daraja-api)

**Daraja products and the Pull Transactions API**
- Core products: **M-Pesa Express / STK Push (Lipa na M-Pesa Online), C2B (Register URL → validation and confirmation), B2C, B2B, Transaction Status Query, Account Balance Query, Reversal**. — [All Business Africa](https://allbusiness.africa/insights/integrate-mpesa-daraja-api-guide); [HelloDuty](https://helloduty.com/blogs/what-is-a-daraja-api)
- **Transaction Status Query** can be used as a polling fallback when callbacks fail. — [All Business Africa](https://allbusiness.africa/insights/integrate-mpesa-daraja-api-guide)
- **Pull Transactions API** (Daraja v3 docs, mirrored):
  - A reconciliation API that returns **all C2B transactions under a Paybill or Till for the last 48 hours**, including notifications that never reached the callback URL.
  - Flow: a POST registers the shortcode for pull, then a GET pulls a date range.
  - Asynchronous; reachable over the internet, VPN or multiprotocol switch.
  - — [Daraja v3 docs mirror: PullTransaction.md](https://glama.ai/mcp/servers/@JacksCodeVault/mpesa-daraja-mcp/blob/e875f3b350a0119c928c623c4e0cdd8999a5d329/daraja_docs_v3/docs/PullTransaction.md)
- **M-Pesa Ratiba** (standing orders), launched as a consumer feature:
  - Customers set daily, weekly, monthly or yearly automatic payments to people, bills or subscriptions.
  - Business use: subscriptions, loan repayments, insurance premiums and **SACCO contributions**, with the customer approving via an M-Pesa prompt.
  - — [Eastleigh Voice](https://eastleighvoice.co.ke/m-pesa%20transactions/79169/safaricom-rolls-out-standing-order-feature-for-m-pesa-users)
  - Community Daraja SDKs and MCP servers expose `ratiba_create` (standing-order creation) under Daraja 3.0. — [Glama daraja-mcp (secondary)](https://glama.ai/mcp/servers/parseen254/daraja-mcp/tools/ratiba_create); [akika/laravel-mpesa-multivendor](https://root.packagist.org/packages/akika/laravel-mpesa-multivendor)

**Going live on Daraja**
- Requirements:
  - A **valid, active Paybill or Till registered to the business**.
  - A defined use case.
  - Public HTTPS callback URLs.
  - Tested sandbox flows.
  - A **signed go-live request letter**.
  - **IP whitelisting** of production servers.
- After go-live, the production Lipa na M-Pesa passkey is emailed. B2C and similar products need an initiator username and security credential. — [DEV.to go-live guide](https://dev.to/msnmongare/how-to-go-live-with-m-pesa-daraja-api-production-environment-4h96); [Nestict](https://www.blog.nestict.com/step-by-step-guide-to-going-live-on-m-pesa-daraja/)

**M-Pesa business statements**
- Business statements exported from the **M-PESA business (Org) portal** have these columns: **Receipt No, Completion Time, Details, Transaction Status, Paid In, Withdrawn, Balance**. They can be exported as CSV. — [Kolonell (secondary)](https://kolonell.com/en/blog/mpesa-statement-export-accountants-dar-es-salaam-2026); [mctaba (secondary)](https://mctaba.com/learn/paystack/reconciling-paystack-against-an-m-pesa-statement)
- The M-PESA for Business app also exports statements. — [Google Play](https://play.google.com/store/apps/details?id=com.safaricom.mpesa.orgapp&hl=en)

**Tariffs: Till (Buy Goods), Paybill and Pochi la Biashara (Aug 2026)**
- **Buy Goods (Till) merchant fee from 7 Aug 2026:** collections are free up to **KES 500** (previously KES 200). Above that the fee is **0.55%** (KES 501–36,363), capped at **KES 200** above KES 36,363. — [Khusoko, Aug 2026](https://ftp.khusoko.com/2026/08/01/safaricom-mpesa-merchant-charges-cut-pata-more/); [The Kenya Times](https://thekenyatimes.com/business/safaricom-reduces-m-pesa-business-charges-list-of-new-charges/)
- **Till → wallet ("pay to mobile") and Till → Paybill transfer fees cut by up to about 50%**, in line with CBK pricing principles. Examples:

  | Transfer band | New fee | Old fee |
  |---|---|---|
  | KES 101–500 | KES 4 | KES 7 |
  | KES 501–1,000 | KES 7 | KES 13 |
  | KES 1,501–2,500 | KES 17 | KES 33 |
  | KES 15,001–20,000 | KES 53 | KES 105 |

  — [The Standard](https://www.standardmedia.co.ke/business/business/article/2001554316/safaricom-halves-m-pesa-merchant-fees-in-cbk-led-move); [Business Daily](https://www.businessdailyafrica.com/bd/economy/safaricom-cuts-m-pesa-fees-in-cbk-deal-3236738)
- **Pochi la Biashara** promotional schedule, 1 Aug–31 Oct 2026, as reported (who pays was not clear from the summary):

  | Payment band | Fee |
  |---|---|
  | Up to KES 200 | Free |
  | KES 201–500 | KES 7 |
  | KES 501–1,000 | KES 13 |
  | KES 1,001–1,500 | KES 23 |
  | KES 1,501–2,500 | KES 33 |
  | KES 2,501–250,000 | KES 50 |

  — [Tech-ish, Aug 2026](https://tech-ish.com/2026/08/01/mpesa-pochi-buy-goods-tariff-cuts-2026/); [Khusoko](https://ftp.khusoko.com/2026/08/01/safaricom-mpesa-merchant-charges-cut-pata-more/)
- The Star published a Mar 2025 explainer on Lipa na M-Pesa products (Till vs Paybill). — [The Star](https://www.the-star.co.ke/news/2025-03-13-explainer-what-to-know-about-lipa-na-m-pesa)

**Airtel Money Kenya**
- Airtel Money APIs are on the **Airtel Africa Developer Portal** (developers.airtel.africa). The flow is OAuth client_id/secret → token → **Collection API** (USSD push prompt), plus **Disbursement** and **Transaction Enquiry** APIs.
- More than 400 businesses joined in the pilot across Airtel markets. — [Khusoko, 2021](https://khusoko.com/2021/11/19/why-airtel-has-upgraded-its-africa-developer-portal/) [older]; [mctaba Airtel Kenya guide](https://mctaba.com/learn/mpesa/airtel-money-integration-kenya)

### Inferences
- **Recommended architecture for Ledger Link's "live M-Pesa sync":**
  - **C2B Register URL** for real-time confirmations.
  - The **Pull Transactions API** on a schedule, every few hours and always under 48 hours, to backfill missed callbacks. This removes the need for "polling" in the fragile sense.
  - **Account Balance** to check the ledger's M-Pesa clearing balance against Safaricom's.
  - **CSV import of Org-portal statements** for history older than 48 hours and for merchants without API access.
- **Onboarding friction is the main limit.** Each merchant needs their own shortcode credentials, a go-live letter and whitelisted IPs. A multi-tenant SaaS should either:
  - become a Safaricom-approved integrator or "technical partner" able to onboard merchant shortcodes, or
  - go through an aggregator (Kopo Kopo K2 Connect, IntaSend, Paystack) for smaller merchants.
- **Tariffs:** with Buy Goods now free up to KES 500, duka transaction volume on Tills will likely rise. Ledger Link's fee auto-posting (0.55% bands, cap KES 200, transfer fees) must use the **Aug 2026 tariff tables** and handle effective dates in the tariff logic.
- **Ratiba** is a strong fit for SACCO contributions and recurring service-firm retainers. It could auto-create recurring invoices with matching standing orders.
- **Pochi la Biashara** is a personal-line merchant product with no Paybill or Till. It likely cannot use Daraja C2B, so Ledger Link must rely on statement or SMS import for those users. (This is an assumption; the Daraja docs on Pochi could not be fetched.)

### Gaps
- Not confirmed from primary Safaricom docs:
  - Daraja 3.0 rate limits.
  - Whether the Pull Transactions API needs separate Safaricom approval.
  - Whether a statement API beyond 48 hours exists.
  - The B2C/B2B tariff tables (business-bouquet charges for disbursements).
- No confirmation on Pochi la Biashara API access.
- No current (2025–26) Airtel Money Kenya merchant tariffs or API terms; the Airtel portal source is from 2021.
- The Daraja "March announcement" and full 3.0 migration timeline are mentioned only in a TechCabal search summary and could not be verified.

## 4. Kenyan bank APIs and open banking (Jenga, Buni, Co-op, NCBA, Stanbic, Absa, I&M; PesaLink; CBK; aggregators)

### Takeaway
Kenya has **no live, mandated open-banking regime yet**. The CBK draft framework (2024) reportedly expects full compliance by **Dec 2026**, but that date comes from a secondary source. Bank data access therefore goes bank by bank:
- **Equity Jenga** is the most self-serve, with balance and full-statement APIs.
- **KCB Buni** offers a sandbox with Instant Payment Notifications.
- **Co-op Bank** has an Account Balance & Transactions API.
- **I&M and NCBA** provide corporate host-to-host (H2H) ERP links.

PesaLink opened a **Fintech Programme in Oct 2025** with APIs, a sandbox, BulkPay and PesalinkPay merchant collections. No pan-Kenyan account-aggregator (a Mono or Plaid equivalent) was found; Okra is dead. For SMEs, **CSV/OFX statement import** is still the practical default.

### Cited Findings
**Equity Jenga**
- Endpoints, per community SDK documentation:
  - **Account balance** (current and available) and **opening/closing balance for a date**.
  - **Full statement** (account, country code, from and to dates, limit) and **mini statement**.
  - Payments (send money, receive payments, bill pay), airtime, forex, KYC and loans.
  - Requests are signed with SHA-256 using an RSA private key; the public key is uploaded to JengaHQ.
  - — [equity-jenga-api readthedocs](https://equity-jenga-api.readthedocs.io/en/stable/api.html); [Getting started](https://equity-jenga-api.readthedocs.io/en/stable/getting_started.html); [jenga-go](https://pkg.go.dev/github.com/gats/jenga-go)
- Jenga launched as Equity's payment-gateway API, giving access to telcos, wallets, card schemes, government and credit bureaus. — [Glenbrook](https://glenbrook.com/payments_news/kenyas-equity-bank-launches-jenga-api-gateway/) [older]
- Fees and onboarding terms were not found.

**KCB Buni**
- Developer platform with a **sandbox** (sandbox.buni.kcbgroup.com).
- Account Service APIs include Get Forex, **Instant Payment Notifications**, Bill Query and Account/Customer Validation; a Funds Transfer API is also available. — [KCB Buni](https://buni.kcbgroup.com/); [DEV.to KCB funds transfer](https://dev.to/msnmongare/kcb-funds-transfer-api-4ja8)
- KCB offers flat **KES 20** PesaLink transfers ("Tuma Direct na 20"), May 2026. — [Tech-ish, May 2026](https://tech-ish.com/2026/05/11/kcb-pesalink-flat-kes-20-tuma-direct-na-20/)

**Co-operative Bank**
- Developer portal at developer.co-opbank.co.ke with an **Account Balance & Transactions** API product, and possibly payment initiation. An unofficial Python SDK exists (pytekcoopbank). — [Open Banking Tracker](https://openbankingtracker.com/provider/co-operative-bank-kenya/apis); [banq.ai](https://www.banq.ai/provider/co-operative-bank-kenya/apis); [PyPI pytekcoopbank](https://pypi.org/project/pytekcoopbank)

**I&M, NCBA, Stanbic and Absa**
- **I&M Bank Payment API Gateway:** a host-to-host module over VPN or point-to-point link. Payment files go from the customer's ERP to the bank, and **a return file comes back to the ERP "for auto reconciliation"**. — [I&M Payment API Gateway](https://www.imbankgroup.com/ke/business-solutions/paymentapigateway/)
- **NCBA:** host-to-host two-way payment data transfer from ERP, plus "Instant Payment through API Integration". — [NCBA payment solutions](https://ke.ncbagroup.com/for-corporates/payment-solutions); [NCBA transaction channels](https://ncbagroup.com/ke/for-corporate/transaction-channels-corporate/)
- **Stanbic and Absa Kenya:** no public developer portal or SME API was found in the results.

**PesaLink (IPSL)**
- The **Pesalink Fintech Programme** (Oct 2025) gives fintechs access to Pesalink APIs and the settlement network.
  - **More than 26 fintech partners** onboarded.
  - Preferential access and pricing with selected settlement banks.
  - New **BulkPay** (hundreds of instant payments through one API) and **PesalinkPay** (merchants receive instant account-to-account payments).
  - A **Pesalink Sandbox**.
  - — [HapaKenya, Oct 2025](https://hapakenya.com/2025/10/23/pesalink-launches-fintech-programme-to-supercharge-innovation-in-digital-payments/); [Citizen Digital](https://citizen.digital/article/pesalink-launches-fintech-programme-to-boost-innovation-and-collaboration-n371850); [Capital FM](https://www.capitalfm.co.ke/news/2025/10/pesalink-fintech-programme-to-accelerate-innovation-and-collaboration)
- Pesalink and Cellulant (Tingg) partnered to scale C2B payments from bank accounts to merchants. — [TechEconomy](https://techeconomy.ng/cellulant-to-lay-off-20-of-its-workforce) [older]
- IntaSend resells PesaLink payouts at KES 100–500 per transfer by band. — [IntaSend](https://intasend.com/payments/pesalink-api-how-to-get-started-and-everything-you-need-for-bank-transfers-in-kenya)

**CBK open banking**
- **CBK** published a **draft open-banking framework in March 2024**, with full compliance "anticipated by December 2026". It uses REST APIs, OAuth 2.0 and ISO 20022, and covers identification/authentication, account information, transaction initiation and API formats.
  - This comes from a vendor blog (secondary) and could not be checked against a CBK primary document.
  - — [WorldFIS (secondary)](https://kenya.worldfis.com/blogs/open-finance-roadmaps-preparing-kenyan-institutions-for-api-driven-data-sharing); [The Paypers](https://thepaypers.com/fintech/news/central-bank-of-kenya-releases-plan-to-implement-open-banking); [Fiskil open-finance tracker](https://www.fiskil.com/open-finance-tracker/kenya)
- CBK's **National Payments System Vision & Strategy 2021–2025** called for modernising payments through API-driven frameworks and interoperability between banks, mobile money operators and fintechs. — [CBK NPS Vision & Strategy PDF](https://www.centralbank.go.ke/wp-content/uploads/2020/12/CBK-NPS-Vision-and-Strategy.pdf) [older]
- CBK is reportedly drafting a **national instant payment switch** to cut transfer costs. — [Kenya Today (report)](https://kenya-today.com/report-cbk-drafts-national-instant-payment-switch-to-cut-transfer-costs-5295)

**Aggregators**
- **Okra is dead** (2025).
- Mono and Stitch are Nigeria- and South Africa-focused; their Kenyan bank coverage was not confirmed.
- **Pngme** is Nairobi-based. — [AllAfrica](https://allafrica.com/stories/202507040471.html); [CB Insights](https://www.cbinsights.com/compare/okra-vs-pngme)

### Inferences
- **Ledger Link's bank roadmap is sound but should be ordered as follows:**
  1. **CSV/Excel statement import** for KCB, Equity, Co-op and Absa, with per-bank column mappers. OFX is rarely offered by Kenyan banks (an assumption to verify with sample statements).
  2. **Equity Jenga statement API**, the most self-serve, as the first live bank feed.
  3. **KCB Buni Instant Payment Notifications** for near-real-time KCB receipts.
  4. **Co-op Account Transactions API**.
  5. I&M and NCBA H2H only for larger clients.
- **PesaLink** can serve two purposes:
  - a collection rail on invoices next to M-Pesa (PesalinkPay), useful for B2B hardware suppliers whose invoices exceed M-Pesa limits, and
  - BulkPay for supplier and salary runs.
- Joining the Pesalink Fintech Programme looks achievable for a SaaS company.
- **Building directly against the CBK framework is premature.** Design the bank-feed layer as an adapter interface so a CBK-standard AIS API can be plugged in when banks go live, which could be 2027 or later.

### Gaps
- No primary CBK document was found for the 2024 draft open-banking framework or its Dec 2026 compliance date. Treat this as unverified.
- No public pricing or onboarding criteria for Jenga, Buni or Co-op APIs, including whether SMEs, as opposed to fintech partners, get statement-API access.
- Not researched because the search budget ran out: the Stanbic and Absa Kenya API programmes, and Lipad.
- No confirmed Kenyan coverage for Mono, Stitch or any account-aggregation API.
- No statement-format specifications (CSV columns) for KCB, Equity, Co-op or Absa.

## 5. WhatsApp Business Platform pricing (2025–26), WhatsApp invoicing and payment flows; M-Pesa Ratiba, Fuliza for business, M-Pesa Global

### Takeaway
- **Since 1 Jul 2025 Meta bills per delivered template message**, replacing per-conversation billing.
- Kenya is in the **"Rest of Africa"** price band at about **$0.0225 per marketing message and $0.0040 per utility message**. These rates come from secondary trackers.
- **From today (1 Oct 2026)**, service messages and utility templates sent *inside* the 24-hour customer-service window are no longer free. They are billed at the utility rate, and each business number gets **1,000 free service messages a month**.
- WhatsApp Pay is not available in Kenya. WhatsApp invoicing therefore has to carry an **M-Pesa STK-push trigger or a payment link** and reconcile through Daraja callbacks, which is where Bumpa and Chpter/Pluto are heading.

### Cited Findings
**Pricing model**
- Per-message pricing replaced conversation-based pricing on **1 July 2025**. — [Sent.dm WhatsApp pricing guide](https://docs.sent.dm/docs/guides/whatsapp-pricing); [Meta pricing docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- After the switch:
  - Utility templates sent inside the customer-service window were free.
  - Outside the window they are charged.
  - Volume-tier discounts apply to **utility and authentication** templates.
  - — [Sent.dm](https://docs.sent.dm/docs/guides/whatsapp-pricing); [Mobile Ecosystem Forum, Feb 2026](https://mobileecosystemforum.com/2026/02/26/whatsapp-business-platform-business-models-2023-2025-updates/)

**Rates (USD per message)**

| Market | Marketing | Utility | Authentication | Source |
|---|---|---|---|---|
| **Kenya ("Rest of Africa")** | **$0.0225** | **$0.0040** | **$0.0080** | Secondary pricing trackers; the authentication figure may be wrong, since Meta usually prices authentication the same as utility — [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing); [Authgear](https://www.authgear.com/post/whatsapp-api-pricing/); [Ominiflow by country](https://ominiflow.com/whatsapp-api-pricing-by-country) |
| South Africa | $0.0379 | $0.0076 | not given | [ChatMaxima SA](https://chatmaxima.com/whatsapp-api-pricing/south-africa/); [Whautomate SA](https://whautomate.com/whatsapp-business-api-pricing-south-africa) |
| Egypt | $0.0644 | $0.0036 | not given | [ChatMaxima Egypt](https://chatmaxima.com/whatsapp-api-pricing/egypt/) |

- A May 2026 Meta rate card exists (Salesforce-hosted MM Lite rate card). — [Salesforce/Meta rate card May 2026](https://www.salesforce.com/en-us/wp-content/uploads/sites/4/WhatsApp-Business-Messaging-Rate-Card-MM-Lite-May-1-2026.pdf)

**1 Oct 2026 change**
- Meta starts charging for **service messages and utility templates sent within the 24-hour customer-service window**, at the same regional rate as utility templates.
- The **first 1,000 service messages per business phone number per month are free**. — [respond.io, WhatsApp pricing change 2026](https://respond.io/blog/whatsapp-pricing-change-2026.md); [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing)
- One source says "from October that same rate [utility/authentication] applies to service messages". — [EngageLab](https://www.engagelab.com/blog/whatsapp-business-api-pricing)

**WhatsApp invoicing and payment flows in Africa**
- **Bumpa (Kenya, 2026)** plans to issue invoices and request payments from inside WhatsApp, Instagram and Facebook chats. — [Capital FM](https://www.capitalfm.co.ke/business/2026/06/bumpa-enters-kenya-to-tap-growing-sme-digital-commerce-market/)
- **Chpter's Pluto** offers a WhatsApp API suite for automated transactions. — [TechCabal](https://techcabal.com/2025/04/02/chpter-spins-off-pluto-as-subsidiary/)
- In typical WhatsApp commerce, the M-Pesa confirmation comes back into the chat and the merchant checks it by hand. — [TechTrends KE](https://techtrendske.co.ke/2026/03/11/africa-whatsapp-commerce/)

**M-Pesa products relevant to invoicing**
- **M-Pesa Ratiba:** standing orders (daily, weekly, monthly or yearly) for recurring bills, subscriptions, loans and SACCO contributions. — [Eastleigh Voice](https://eastleighvoice.co.ke/m-pesa%20transactions/79169/safaricom-rolls-out-standing-order-feature-for-m-pesa-users)
- **Fuliza Biashara:** business overdraft up to KES 400,000. **Taasi Till loan:** up to KES 250,000. — [Moses Kemibaro](https://moseskemibaro.substack.com/p/m-pesa-is-eating-safaricom-the-launch); [Tech-ish timeline](https://tech-ish.com/2026/03/25/m-pesa-2020-to-2026-timeline/)

### Inferences
- **Unit economics for WhatsApp invoicing, at the secondary-source rates:**
  - An invoice sent as a utility template costs about **$0.004 (about KES 0.5)**.
  - A reminder sent as a marketing template costs about **$0.0225 (about KES 3)**.
  - Since 1 Oct 2026, replies and follow-up utility messages inside the 24-hour window are no longer free beyond 1,000 service messages per number per month.
  - So: **classify invoice and receipt templates as UTILITY**; keep payment reminders utility-compliant (transactional wording, not promotional) so Meta does not reclassify them as marketing; and pass WhatsApp costs through or meter them per plan.
- **Recommended flow:**
  1. Send the invoice via a WhatsApp utility template with a "Pay with M-Pesa" button.
  2. The button opens a Ledger Link pay page that triggers an **STK Push** to the customer's phone, using the merchant's own Paybill or Till.
  3. The Daraja callback (or Pull Transactions backfill) marks the invoice paid, posts the journal and sends a WhatsApp receipt.
  - **Use the invoice number as the STK `AccountReference` / BillRefNumber** so auto-matching is deterministic, not AI-guessed.
- **Ratiba-backed recurring invoices** (SACCO contributions, retainers, rent) would be a distinctive feature that none of the competitors found advertises.
- Ledger Link could *surface* Fuliza Biashara and Taasi in its cash-flow views, but these are Safaricom's own credit products; partnering with Moniepoint/Sumac or SACCOs for lending on Ledger Link's books may be more realistic.

### Gaps
- Meta's official Kenya / Rest of Africa rate card could not be read (developers.facebook.com was blocked). The authentication rate of $0.0080 is unverified and possibly wrong.
- **M-Pesa Global**, WhatsApp Pay availability in Kenya, and any Safaricom–Meta tie-up such as M-Pesa inside WhatsApp were not researched because the search budget ran out.
- The detailed Fuliza Biashara and Taasi fee terms were not found.
- Whether Ratiba mandates can be created through Daraja by any merchant, or only by approved billers, was not verified from a primary source.

## 6. Uganda, Tanzania and Rwanda payment APIs for regional expansion

### Takeaway
- **MTN MoMo Open API** (Collections, Disbursements, Remittances; free sandbox; request-to-pay with callback) covers **Uganda and Rwanda**.
- **Airtel Africa's developer portal** covers Uganda, Tanzania, Rwanda and Kenya with a single API style.
- In **Tanzania**, the mobile-money market is split between Vodacom M-Pesa (Open API, different from Daraja), Airtel Money and **Mixx by Yas** (formerly Tigo Pesa: 20m users, more than 500,000 merchants, exclusive SACCO partner). Cross-network aggregators (e.g. Unlimit) now connect all three.
- Each market also has its own tax e-invoicing system: EFRIS in Uganda, VFD/EFD in Tanzania, EBM in Rwanda. This was not researched and would be the equivalent of eTIMS in each country.

### Cited Findings
**MTN MoMo (Uganda, Rwanda)**
- The MoMo Developer Portal offers **Collections** (online payments, bills, loan repayments, contributions), **Disbursements** (bulk payouts, by hand or through the API) and Remittances. — [MTN MoMo Developer Rwanda products](https://momodeveloper.mtn.co.rw/products)
- The sandbox is free. The flow is request → customer approves with PIN on phone → callback. — [mctaba MoMo Uganda](https://mctaba.com/learn/uganda/momo-api-integration-uganda); [mctaba MoMo Rwanda](https://mctaba.com/learn/rwanda/momo-api-integration-rwanda)
- Indicative fees (secondary):
  - Rwanda disbursement about 1%, latency about 2 seconds, wallet cap about RWF 2,000,000.
  - Generally 1–3% per transaction, varying by country and volume. Confirm with MTN.
  - — [Kolonell, Kigali 2026 (secondary)](https://kolonell.com/en/blog/mtn-momo-disbursement-payout-api-kigali-2026); [mctaba (secondary)](https://mctaba.com/learn/rwanda/momo-api-integration-rwanda)

**Uganda tooling**
- Open-source libraries handle MTN plus Airtel collections and disbursements in Uganda (`ugmobilemoney`), and some gateways are "now live in Uganda". — [PyPI ugmobilemoney](https://pypi.org/project/ugmobilemoney/0.0.2/); [Sopra pay](https://pay.sopraent.com/)

**Airtel Money (multi-country)**
- One portal (developers.airtel.africa) covers collections, disbursements and transaction enquiries across Airtel Africa markets. — [Khusoko 2021](https://khusoko.com/2021/11/19/why-airtel-has-upgraded-its-africa-developer-portal/) [older]

**Tanzania**
- **Vodacom M-Pesa** uses the **Vodacom Open API**: C2B, B2C, B2B, reversal and transaction status. **Authentication, endpoints and payloads differ from Daraja.** — [ITWeb, Vodacom TZ opens API](https://itweb.africa/content/O2rQGMAn3VXqd1ea) [older]; [mctaba Vodacom TZ guide](https://mctaba.com/learn/tanzania/integrate-mpesa-vodacom-tanzania)
- **Mixx by Yas** (rebranded from Tigo Pesa):
  - About **20m users**, about **TZS 6 trillion a month** in transactions, **more than 500,000 businesses** accepting payments, about 200,000 agents.
  - **Lipa kwa Simu** lets customers pay by business number or QR code; more than 3,000 institutions take payments through it.
  - M-Pesa, Airtel Money and Mixx together hold about 90% of the market.
  - — [The Citizen](https://www.thecitizen.co.tz/tanzania/news/national/dodoma-residents-urged-to-adopt-mixx-by-yas-digital-payment-solution-5307986); [The Citizen](https://www.thecitizen.co.tz/tanzania/news/national/mixx-by-yas-unveils-kila-hatua-mixx-drive-to-deepen-financial-inclusion-5159978)
- **Mixx by Yas partnered with UBX and SCCULT** (the SACCO union) in May 2025, becoming the **exclusive digital payments partner for SACCO members** in Tanzania. — [The Citizen](https://www.thecitizen.co.tz/tanzania/news/national/mixx-by-yas-partners-with-ubx-and-sccult-to-simplify-contributions-and-loans-for-saccos-in-tanzania-5052998); [IPP Media, May 2025](https://ippmedia.co.tz/the-guardian/business/read/yas-becomes-official-payment-platform-for-credit-societies-2025-05-27-162848)
- **Unlimit** (global payments) expanded in Tanzania in July 2025, connecting **M-Pesa, Mixx by Yas and Airtel Money**. — [TechAfricaNews, Jul 2025](https://techafricanews.com/2025/07/25/unlimit-goes-all-in-on-tanzania-unlocks-m-pesa-mixx-by-yas-and-airtel-money-access-for-global-brands/); [Unlimit press release](https://www.unlimit.com/blog/press-release/unlimit-expands-its-tanzania-presence-connecting-global-businesses-to-the-countrys-80bn-mobile-money-services-market/)
- Kolonell describes **M-Pesa statement export for Tanzanian accountants**, implying a similar CSV workflow there. — [Kolonell (secondary)](https://kolonell.com/en/blog/mpesa-statement-export-accountants-dar-es-salaam-2026)

**Pan-African gateways**
- **Wasoko/MaxAB** operates in Kenya, Rwanda and Tanzania among its five markets. — [TechCabal](https://techcabal.com/2024/08/27/wasoko-maxab-complete-merger/)
- Paystack and Flutterwave are pan-African gateways; Flutterwave covers multiple East African countries. Country-by-country coverage was not verified in this research.

### Inferences
- **Regional expansion order** (driven by rails):
  1. **Uganda and Rwanda via MTN MoMo plus Airtel**: two APIs per country, both with standard request-to-pay plus callback flows similar to STK Push.
  2. **Tanzania via an aggregator** (e.g. Selcom, AzamPay, ClickPesa or Unlimit, not researched), because three MNO APIs are needed and Vodacom's Open API differs from Daraja.
- Ledger Link's rail layer should be an abstraction ("mobile-money provider" adapters with a shared payment-intent, callback and statement-import interface) rather than Daraja-specific code.
- **Mixx by Yas holds the exclusive SACCO payments partnership in Tanzania.** If Ledger Link sells to Tanzanian SACCOs, a Mixx integration (directly or through UBX) is probably required.
- Ledger Link already supports UGX, TZS and RWF. Regional readiness also needs **per-country tax-invoice integrations**: URA EFRIS (Uganda), TRA VFD/EFD (Tanzania) and RRA EBM (Rwanda), plus local payroll rules. This is likely a larger effort than the payment rails.

### Gaps
- Not researched because the search budget ran out:
  - Uganda **EFRIS**, Tanzania **VFD/EFD** and Rwanda **EBM** e-invoicing integration requirements.
  - Tanzanian aggregators: Selcom, AzamPay, ClickPesa.
  - Ugandan aggregators: Yo! Payments, Flutterwave UG, Pesapal UG.
  - Rwanda's eKash / RSwitch.
- No official MTN MoMo tariff for API collections in Uganda or Rwanda; only secondary 1–3% estimates.
- Mixx by Yas merchant API details (developer portal, auth, fees) were not found.
- Competitor accounting products in Uganda, Tanzania and Rwanda (local QuickBooks/Zoho/Odoo usage, EFRIS-certified software) were not researched.
