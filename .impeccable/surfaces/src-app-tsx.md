---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/layout/AppLayout.tsx","src/components/layout/Sidebar.tsx","src/components/layout/Header.tsx","src/components/dashboard/DashboardView.tsx","src/index.css","src/components/layout/LockScreen.tsx"]
---

# Surface brief: the signed-in app

## Scope and mode

Operate. The whole authenticated app under `/app`: shell (spine navigation, page header), home, and every view in order. Sign-in shares the world as the book's cover.

## Audience, job, constraints

Owner and accountant, equally primary. The owner checks cash and decides, often on an Android phone in shop daylight; the accountant posts, reconciles and closes under office light for hours, keyboard first. Must not read as AI-built, generic fintech, an old desktop package, a nostalgic costume, or intimidating to owners. Home answers a bit of everything: KPIs, money position, what needs doing, performance.

Preserve: widget picker (drag, pin, reset), command palette architecture, dark mode switch, print CSS, Zustand store, TanStack Query, every working behaviour and route.

## Chosen direction and memorable moment

The Counter Book. The memorable moment: scrolling a long ruled table while the balance brought forward stays pinned at its head and the balance carried forward at its foot, recomputed for the rows in view.

## Unresolved

Swahili strings for navigation and empty states are not yet written; layouts must tolerate longer labels. Self-hosting Archivo is deferred to the weight phase.

## Direction contract

THESIS: Ledger Link is the counter book every Kenyan duka already keeps, ruled for money, with the database doing the adding up. It refuses the category default of floating KPI cards on grey with an area chart and a blue accent.

OWN-WORLD: Bright ledger paper (#FBFCFD) with feint blue ruling (#C9D8EA) and a stationery-red margin rule (#B3202F). Oxblood bookcloth spine (#5A1A1F) carries navigation, with the active section pulled out as a paper thumb-index tab. Archivo only: printed labels, column heads and navigation groups in condensed caps (width 72); page and section headings condensed (width 78) in mixed case, adapted from all-caps so an owner reads them at a glance on a phone and longer Swahili headings still fit; body and figures at width 100 with tabular figures. Amounts split into Shs and Cts columns by a red rule. Palette law: ballpoint blue (#1C3F94) for entered figures only, red for totals rules, losses and errors only, auditor's green (#1E6B45) ticks for reconciled or paid, graphite "?" queries for what needs attention, oxblood for the primary action and focus. Dark mode is the carbon sheet (#10141D) with pale impressions. Square rules, 3px controls, no card shadows.

STORY: The owner sees in one page whether the business is fine and what is owed; the accountant sees today's queries and entries and goes straight into work. Both trust every figure because it reads like a book an auditor would sign.

FIRST VIEWPORT: Desktop 1440. Left 232px oxblood bookcloth spine with the name stamped in a double-ruled label and the organization beneath it, plain literal section names in three printed groups, the open section as a paper index tab running into the page. A 56px top strip carries the drill path (organization / section), find, and the contextual add. The page opens on today's heading ruled heavy beneath: weekday and date large in condensed type, the year, whose books, the currency, and how far the books are posted; page number (day of year), Arrange page and the primary "Post an entry" at its right. Beneath, analysis columns separated by printed rules: Cash, Owed to you, You owe, Net profit, each a 32px ballpoint-blue Shs|Cts figure with its note and a link, the cash figure marked when it changed since the last visit. Below, a queries column inside a red double margin (overdue invoices, unmatched bank lines, bills to pay, PAYE/NSSF/SHIF, Housing Levy and VAT dates) beside a ruled recent-entries table closing on a red double-ruled total.

FORM: Kenyan counter book and analysis cash book, position 3 of 7 on the ordered list; seed key 541562f3. Raises: literal wayfinding with one active accent; pinned drill path; account codes as handles and instant selection; fixed-scale monthly small multiples; palette law; fixed digit positions with a marked change. Signature interaction: pinned brought-forward and carried-forward balances on long tables. Motion grammar: selection is instant; the only authored motion is the pen tick stroke on reconcile, under 150ms, disabled under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
