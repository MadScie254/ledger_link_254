---
name: Ledger Link
description: Double-entry accounting for Kenyan businesses, ruled like the counter book on the shop counter.
colors:
  paper-ground: "#FBFCFD"
  paper-sheet: "#FFFFFF"
  paper-tab: "#EEF2F7"
  feint: "#D5E0EE"
  feint-strong: "#A9BEDA"
  ink: "#1A1D24"
  graphite-700: "#343A46"
  graphite-600: "#4B5361"
  graphite-500: "#5F6776"
  graphite-400: "#8C93A0"
  field: "#7F899B"
  ink-blue: "#1C3F94"
  ledger-red: "#B3202F"
  auditor-green: "#1E6B45"
  oxblood: "#5A1A1F"
  oxblood-deep: "#45121A"
  spine-raised: "#6B2228"
  spine-ink: "#F6EDEA"
  spine-muted: "#D9B8B4"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(28px, 4vw, 34px)"
    fontWeight: 650
    lineHeight: 0.98
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 78"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 78"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 78"
  figure-lead:
    fontFamily: "Archivo, ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "'tnum' 1, 'lnum' 1"
    fontVariation: "'wdth' 100"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'tnum' 1, 'lnum' 1"
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 72"
rounded:
  none: "0px"
  xs: "2px"
  sm: "3px"
spacing:
  rule-row: "8px"
  field-inset: "12px"
  gutter-sm: "16px"
  gutter-md: "24px"
  gutter-lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.oxblood}"
    textColor: "{colors.paper-sheet}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.oxblood-deep}"
  button-secondary:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  button-quiet:
    textColor: "{colors.oxblood}"
    typography: "{typography.body}"
  input-field:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "40px"
  input-amount:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.ink-blue}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "40px"
  nav-item:
    backgroundColor: "{colors.oxblood}"
    textColor: "{colors.spine-ink}"
    typography: "{typography.body}"
    padding: "0 12px 0 16px"
    height: "36px"
  nav-item-active:
    backgroundColor: "{colors.paper-ground}"
    textColor: "{colors.ink}"
  index-tab-active:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  figure:
    textColor: "{colors.ink-blue}"
    typography: "{typography.body}"
---

# Design System: Ledger Link

## Overview

**Creative North Star: "The Counter Book"**

Ledger Link is the hardcover counter book every Kenyan duka already keeps, rendered in a browser: bright ledger paper with feint blue ruling, a stationery-red margin, figures written in ballpoint blue, and an oxblood bookcloth spine carrying the section index. The database does the adding up; the interface only has to read like a book an auditor would sign. Dark mode is the carbon sheet: the same page as a pale impression on near-black.

The page is dense and ruled, not boxed. Sections are separated by printed rules (a heavy 2px ink rule under a page heading, feint 1px rules between rows), never by floating cards on grey. Every figure sits in fixed digit positions, split into shillings and cents by a thin red rule, so columns of money align down the page on a phone in shop daylight and on a desk monitor through a long reconciliation session. Selection and opening are instant; the only authored motion is the pen stroke of an auditor's tick.

The build refuses the category default of fintech dashboards: KPI tiles on grey, area charts, a blue brand accent, frosted glass and soft card shadows. Blue here is ink on the page, not a brand.

**Key Characteristics:**
- One typeface, Archivo, at three widths: printed caps (72), condensed headings (78), body and figures (100).
- Palette law: every hue has exactly one job, and no role borrows another's colour.
- Ruled paper, square sheets, 2–3px controls; shadows only on sheets lifted over the page.
- Figures as Shs|Cts with brackets for negatives and an en dash for nil.
- Pinned brought-forward and carried-forward balances on long ledgers.

## Colors

A paper-and-stationery palette: near-white paper, pencil greys, and four inks that each mean one thing. Light values are normative in the frontmatter; the carbon-sheet (dark) values are recorded in `.impeccable/design.json`. The direction contract named the feint rule #C9D8EA and the carbon ground #10141D; the build shipped the slightly lighter feint and #0F131B, and the build is the record.

### Primary
- **Bookcloth Oxblood** (oxblood): the binding. The spine behind the section index, the one filled primary action on a page or dialog, quiet text actions and links, the active index-tab underline, checkbox and radio accent, and every focus ring (2px outline, 2px offset). In dark mode it splits: text and focus go light (#E9A7AB) while filled buttons stay deep (#8E2F37).
- **Pressed Oxblood** (oxblood-deep): hover state of the filled primary only.
- **Raised Cloth** (spine-raised): hover row on the spine.
- **Spine Ink / Spine Muted** (spine-ink, spine-muted): section names and the organization line stamped on the spine; group labels and the signed-in footnote.

### Secondary
- **Ballpoint Blue** (ink-blue): figures written into the book. Transaction amounts, balances in lists, headline position figures on Home, and the typed value in an amount field. Also the text caret and the 20% text-selection wash, because both are the pen. Never a link, button, chart fill, focus ring or heading.

### Tertiary
- **Stationery Red** (ledger-red): printed rules and trouble. The single rule above and 3px double rule below a total, the red double margin down a queries column, the hairline dividing shillings from cents in every figure, losses (negative results), books out of balance, circled exceptions (overdue, failed), field errors and load failures.
- **Auditor's Green** (auditor-green): the tick. Reconciled, matched, paid, verified. Appears as a drawn tick mark with its word beside it, not as fills or badges.

### Neutral
- **Ledger Paper** (paper-ground): the page ground and the active spine tab that runs into it.
- **Clean Sheet** (paper-sheet): dialogs, menus, top strip, fields, secondary buttons.
- **Index Card** (paper-tab): hover wash on rows and menu items, skeleton bars, the specimen strip.
- **Feint Ruling** (feint): row rules, card borders, dialog footers.
- **Strong Ruling** (feint-strong): column-head underlines, top-strip rule, section rules under titles, overlay borders.
- **Printer's Ink** (ink): body text, headings, the heavy rule under a page heading, results and totals.
- **Graphite 700 / 600 / 500 / 400**: secondary text, column heads (600), notes, placeholders and nil dashes (500), empty-cell dashes (400). Graphite also draws the query mark.
- **Field Stroke** (field): the border of inputs, selects and secondary buttons.

### Named Rules
**The Palette Law Rule.** Blue is for figures, red for rules and trouble, green for ticks, graphite for queries, oxblood for the binding. No element picks a colour for emphasis or decoration; if a role is not on that list, it is ink or graphite.

**The Ballpoint Rule.** A figure written into the book is blue; a figure the book prints about itself (a total, a result, a figure carried from elsewhere) is ink. Nothing that is not a money figure is ever blue.

**The Red Ink Rule.** Red is never a fill for decoration and never a warning tone. It rules totals and margins, divides Shs from Cts, and marks losses and errors.

## Typography

**Display Font:** Archivo at width 78 (with ui-sans-serif, system-ui, Segoe UI, Roboto fallback)
**Body Font:** Archivo at width 100 with tabular, lining figures
**Label/Mono Font:** Archivo at width 72, uppercase

**Character:** A single grotesque stretched three ways, the way a stationer's printed headings, a clerk's column heads and the written entries share one book. Archivo is loaded as one variable file from Google Fonts (`wdth 62..125`, `wght 100..900`); self-hosting is deferred. Every font slot, including serif and mono, resolves to Archivo.

### Hierarchy
- **Display** (650, 28px mobile / 34px from 640px, line-height 0.98, width 78, -0.01em): the page heading, mixed case, ruled heavy beneath. On Home it is the weekday and date.
- **Headline** (650, 22px, tight, width 78): dialog titles.
- **Title** (650, 17px, width 78): section headings inside a page, ruled with strong feint beneath.
- **Figure Lead** (400, 21px / 26px / 32px across breakpoints, line-height 1, width 100, tabular): the position figures across the top of Home. Statement results step down to 20–22px.
- **Body** (400, 13.5px, width 100, tabular lining figures): table rows, ledger rows, notes at 13px, field text at 14px, buttons at 13.5px semibold.
- **Label** (650, 11px, 0.06em, uppercase, width 72): table column heads, position labels (CASH, OWED TO YOU), spine group names at 10.5px, the SPECIMEN tag, page number. The wordmark on the spine is the same printed caps at 15px with 0.14em tracking.

### Named Rules
**The Three Widths Rule.** Width 72 is always uppercase and always a printed label; width 78 is always a mixed-case heading; width 100 is everything read or added up. Headings are never set in caps, so a longer Swahili heading still fits on a phone.

**The Fixed Digit Rule.** Tabular, lining figures are on at the body, on every table and on every figure. A column of money never shifts a digit.

## Layout

A fixed spine and a ruled page. On desktop the oxblood spine is 232px (14.5rem), sticky to the viewport, with sections in three printed groups (Money, Books, Office); below 768px it becomes a sheet that slides over the page from a menu button. A 56px top strip on clean paper carries the drill path (organization / section), find with its Ctrl K hint, a contextual add, the paper/carbon switch and notifications.

The page body is capped at 92rem and padded 16px / 24px / 32px at mobile, 640px and 1024px, with 20px top padding growing to 28px on large screens. Pages open on their heading block ruled 2px in ink, with actions right-aligned on the same baseline from 640px and stacked above on mobile. Beneath, content is arranged in analysis columns separated by printed rules rather than gaps in grey: Home runs a two-by-two position band that becomes four across at 1024px, then a 19rem queries column beside the recent-entries table, then paired sections.

Rhythm is ruled: table rows carry 8px vertical padding, ledger rows 8px, loading rows hold a 40px pitch. Index tabs sit on a strong feint rule with 24px between labels and scroll horizontally on mobile with a fade at the right edge.

**The Ruled Not Boxed Rule.** Group content with rules and whitespace. A bordered container is for a sheet (dialog, menu, palette), not for a section of the page.

## Elevation & Depth

The page is flat. Paper does not cast shadows on the desk: every small and medium shadow token resolves to nothing, and blur tokens are zero, so no frosted glass can appear. Depth exists only when a sheet is lifted over the page, and it is one soft, low-offset shadow with a 45% black backdrop behind modal sheets.

### Shadow Vocabulary
- **Lifted sheet** (`box-shadow: 0 18px 40px -16px rgb(12 16 24 / 0.32), 0 3px 8px rgb(12 16 24 / 0.08)`; carbon: `0 18px 40px -16px rgb(0 0 0 / 0.6), 0 3px 8px rgb(0 0 0 / 0.3)`): dialogs, the command palette, the organization menu, the notifications menu, the undo toast, the bulk action bar and the mobile spine.
- **Field focus** (`box-shadow: 0 0 0 1px` oxblood): the second stroke that thickens a focused field's border. Not elevation.

### Named Rules
**The Lifted Sheet Rule.** A shadow means "this sheet is above the page and will go away". Nothing that lives on the page casts one.

## Shapes

Square rules and the slightest cut-card round on controls. Page sections and surface cards are 0px; buttons, fields, selects and the find box are 3px; 2px is the smallest step. Nothing is pill-shaped or circular except the drawn circled-exception mark. Borders are 1px hairlines in feint or field grey; the page heading rule is 2px ink; a total closes on a 1px red rule above and a 3px double red rule below. The command palette carries a 2px ink rule along its top edge.

**The Cut Card Rule.** No radius above 3px anywhere.

## Components

### Buttons
Plain printed controls with one vocabulary across every page.
- **Shape:** slightly cut corners (3px), 36px tall.
- **Primary:** oxblood fill, white 13.5px semibold label, 14px inline padding. One per page heading or dialog footer; when tabs change what the page adds, the primary changes with them rather than multiplying.
- **Hover / Focus:** fill deepens to pressed oxblood; focus is the global 2px oxblood outline at 2px offset. No transitions. Disabled at 50% opacity.
- **Secondary:** clean-sheet ground, field-grey 1px border, ink label; border darkens to ink on hover. Used for Export, Print, Cancel and every other button action.
- **Quiet:** oxblood 13px text underlined 3px below at 40% strength, strengthening on hover. Used inside rows and sentences (Try again, All invoices, Reports).

### Index Tabs
- **Style:** plain 14px labels on a strong feint rule; the selected tab is ink semibold with a 2px oxblood underline, others graphite, darkening on hover. Counts print in brackets.
- **State:** instant; no sliding indicator.

### Cards / Containers
- **Corner Style:** square (0px).
- **Background:** clean sheet on ledger paper.
- **Shadow Strategy:** none; see Elevation & Depth.
- **Border:** 1px feint.
- **Internal Padding:** 20px inline in dialogs, 16px top and 12px bottom around a dialog title.

### Inputs / Fields
- **Style:** clean-sheet ground, 1px field-grey stroke, 3px corners, 40px tall, 12px inline padding, 14px text; placeholder in graphite 500 at full opacity. Labels are 13px semibold ink above the control, hints 12.5px graphite below. Amount inputs are right-aligned tabular figures in ballpoint blue; KRA PIN inputs force uppercase.
- **Focus:** border turns oxblood and gains a second 1px oxblood stroke; no outline glow.
- **Error / Disabled:** a 12.5px red message below with role alert, and a red border on the field.

### Navigation
- **Spine:** oxblood bookcloth, flat. The wordmark is stamped in printed caps inside a double-ruled label (two 1px rules in 14% spine ink, 3px apart) with the organization name beneath. Group names in 10.5px printed caps, muted. Items are 36px rows of 13.5px spine ink, no icons, no counts; hover raises the cloth.
- **Active:** the open section becomes a paper thumb-index tab in ledger paper with ink semibold text, extending 1px into the page so it reads as one sheet.
- **Top strip:** 56px clean sheet on a strong feint rule; drill path in 13px graphite with the section in ink semibold.
- **Mobile:** the spine slides over a 45% backdrop as a lifted sheet; search and add collapse to icon buttons with labels for assistive tech.

### Amount (signature)
A figure as written into a counter book. Shillings grouped en-KE, a 1px red hairline at 80% strength, then two-digit cents. Negatives are wrapped in brackets; nil prints an en dash in graphite 500. The currency is never repeated on the figure; the column head or label carries it, and the accessible name speaks it ("KES 1,931,250.00", "KES nil"). Tones: figure (ballpoint blue, default), ink (printed figures and totals), result (ink, red when negative), alert (red whatever the sign). Sizes run 11 / 13 / 15 / 20–22 / 21–32px. Amounts show the cents they arrive in; conversion happens once at statement level and is announced.

### Marks
The auditor's margin marks, drawn as 16px pen strokes with a 2px round-capped line: tick (green, agreed), query (graphite "?", needs attention), circled (red, exception). A mark always has its word beside it or in its row. When a line is freshly matched, reconciled or paid, the stroke draws once over 140ms (`cubic-bezier(0.16, 1, 0.3, 1)`); under reduced motion it appears already drawn. This is the only authored motion in the system.

### Totals and Statements
Ledger rows put the label left and the figure right on a feint rule. A subtotal takes a 1px ink rule above; a total or result takes the red single-over-double rule. Statement pages print the organization, period and "Figures in KES" under the heading, with Print and Excel as secondary and Export PDF as the one primary.

### Running Ledger (signature)
A scrolling account ledger with Date, Particulars, Debit, Credit and Balance. The column heads and the brought-forward row stay pinned at the top and the carried-forward row at the foot, both recomputed for the rows whose text is in view ("Brought forward from 14/03/2026"). The foot closes on the red rule with its balance double-ruled. Balances read with Dr or Cr, never signs; rows snap to rest under the pinned line; dates are dd/MM/yyyy.

### Dialog
A lifted sheet portalled to the body: square, clean sheet, strong feint border, the lifted-sheet shadow, a headline title ruled 2px in ink, a feint-ruled footer holding secondary then primary. No entrance animation. The rest of the page is inert, focus is trapped and returns to its opener, Escape and the backdrop close only the topmost of stacked sheets.

### Tables
Every table in the app shell or a lifted sheet follows one rule set: separated borders with zero spacing (so a red total rule is never lost to a feint rule), column heads in 11px printed caps graphite 600 on a strong feint rule, 8px row padding on feint rules, and a paper-tab hover wash. Dates in table rows are dd/MM/yyyy.

## Do's and Don'ts

### Do:
- **Do** write money through the Amount figure: Shs|Cts with the red hairline, brackets for negatives, an en dash for nil, currency in the column head.
- **Do** keep one filled oxblood primary per page heading or dialog; every other action is secondary or quiet.
- **Do** close totals on a 1px red rule above and a 3px double red rule below.
- **Do** separate sections with rules: 2px ink under a page heading, 1px strong feint under a section title, 1px feint between rows.
- **Do** set printed labels and column heads in Archivo width 72 caps at 0.06em, headings at width 78 in mixed case, and everything else at width 100 with tabular figures.
- **Do** pair every tick, query or circled mark with its word.
- **Do** label anything specified but unbuilt as "Not built" and never render it as a working control.
- **Do** state statutory dates by their rule (PAYE, NSSF and SHIF by the 9th; the Housing Levy by the ninth working day; VAT by the 20th; moved off weekends) from the one shared deadline source.

### Don't:
- **Don't** use ballpoint blue for links, buttons, focus, chart fills or anything that is not a money figure.
- **Don't** use red as a warning, notice or emphasis colour; it is for total rules, the Shs|Cts divider, losses and errors.
- **Don't** put KPI figures in floating cards on grey, add area charts, or give the brand a blue accent.
- **Don't** cast a shadow from anything that lives on the page, or use backdrop blur.
- **Don't** round anything beyond 3px or make pills.
- **Don't** animate opening, selection, hover or tabs; the pen tick is the only motion.
- **Don't** set a heading in all caps or place a printed-caps eyebrow above a heading.
- **Don't** repeat the currency code on every figure.
