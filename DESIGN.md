---
name: Ledger Link
description: Calm accounting workspace for Kenyan organizations.
designTokens: src/index.css
---

# Ledger Link design system

Ledger Link uses a light, comfortable corporate workspace. Business uses Evergreen; Mizani uses indigo and Kundi uses plum. The edition changes the accent, not the meaning of financial status colours. The interface keeps the same data and posting behavior across themes.

## Token architecture

`src/index.css` is the source of truth. Raw `--raw-*` values feed semantic roles such as `--primary`, `--surface`, and `--text`. Tailwind v4 `@theme inline` maps those roles to utilities such as `bg-primary`. Older utility names remain compatibility aliases while screens migrate. New UI uses semantic names.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #F3F5F8 | #0A101B |
| Surface | #FFFFFF | #111A28 |
| Surface 2 | #F8FAFC | #152033 |
| Hover | #F1F4F8 | #1A263B |
| Border | #E2E7EE | #233149 |
| Strong border | #C8D1DC | #33435E |
| Text | #0F1A2A | #E7ECF3 |
| Text 2 | #465467 | #A9B4C4 |
| Text 3 | #69778A | #8290A4 |
| Primary | #0E7A5B | #3CC296 |
| Primary hover | #0A6449 | #5CD2AA |
| Primary soft | #E4F2EC | rgba(60,194,150,.15) |
| Primary ink | #0A4E3A | #A3E6CE |
| On primary | #FFFFFF | #08130F |
| Positive | #12804A | #4CC385 |
| Warning | #B25E0A | #EAA250 |
| Negative | #C1362C | #F27D73 |
| Info | #2457C5 | #86AAF3 |
| Neutral soft | #EEF1F5 | #1C2840 |

Positive, warning, negative, and info soft roles are #E5F5EB, #FDF0DF, #FCE9E7, and #E8EFFC in light mode. Each uses its main colour at 15% alpha in dark mode. Edition accents on `data-edition`: Mizani #3B3FB6 / #8F93F2 dark; Kundi #7A3A86 / #C98AD4 dark. The company accent picker remains available, with Evergreen as default.

Charts use primary for income and #A9BBD1 for expenses (#4E6382 dark). Categories use primary, #6E8DB3, #E0A13A, #8E6CC0, #3FA7B5, and #B4BECB. Status colours retain their meaning regardless of edition or company accent.

## Typography and figures

Inter Variable is self-hosted for UI, tables, labels, and figures. Plus Jakarta Sans Variable is self-hosted for headings and large figures. Display is 28/34 at weight 800; page title 22/28 at 700; summary figure 24/28 at 700; card title 15/20 at 600; body and table 14/20 at 400; label and hint 12.5/16 at 500; table header 12 at 600. Figures use tabular numerals and align right. Negative amounts use red brackets.

Use sentence case for headings and actions. Ledger Link is always two words. Success feedback reads like a receipt. Follow `PRODUCT.md` for voice and translated strings.

## Shape, space, and depth

Spacing follows a 4px grid. Buttons and inputs have 8px radius, cards 12px, dialogs and drawers 16px, pills 999px. Standard controls are 36px high; small 30px and large 40px. Phone touch targets are at least 44px.

| Shadow | CSS value |
| --- | --- |
| Small | `0 1px 2px rgba(16,24,40,.06), 0 1px 1px rgba(16,24,40,.03)` |
| Medium | `0 6px 16px rgba(16,24,40,.10), 0 1px 3px rgba(16,24,40,.06)` |
| Large | `0 16px 40px rgba(16,24,40,.16), 0 2px 6px rgba(16,24,40,.06)` |

Hover transitions are 120ms, menus 160ms, and drawers 220ms, with `cubic-bezier(.2,.8,.2,1)`. Turn animation off under `prefers-reduced-motion`.

## Workspace patterns

The desktop shell has a light sidebar with grouped icons, a full-width New action, a search-driven top bar, and a saved 68px icon rail option. The phone shell has a five-position tab bar with New in the middle. New opens a bottom sheet on phones and a centered menu on larger screens. Every available view remains reachable through the sidebar or More.

Cards use a surface, subtle border, and small shadow. Dashboard cards reflow from four columns to two and then one. Lists use sortable tables on desktop and stacked rows on phones, with comfortable density by default and a compact switch. Record details open in a right drawer. Forms use a full-page workspace, searchable comboboxes, line grids, live totals, a client-side document preview, and a pinned action footer.

Primary buttons use the edition or company accent; secondary buttons have a border; ghost buttons use a hover surface; danger uses negative. Use one clear primary action per task. Inputs, tabs, menus, and dialogs keep visible focus rings and full keyboard access. Dialogs trap focus and return it on close. Contrast must meet WCAG AA.

Status pills: Paid is positive green; Part paid is info blue; Not due is neutral; Overdue is warning amber; Void is neutral with struck-through text. On-screen totals use one divider. The double rule under totals belongs only on printed PDFs.

Mizani and Kundi use the same components and layout with their edition accents. Their sections are built: matters, the court diary, time, the client account, disbursements and fee notes for Mizani; members, households, giving, the cash count, funds and the treasurer's report for Kundi. New puts each edition's own actions first (a matter, a court date, time, a client receipt; a gift, a cash count, an M-Pesa statement, a member), and the phone tab bar shows each edition's daily pages. A section is shown as planned only if it is listed in `PLANNED_EDITION_VIEWS`, which is empty today. Do not present drafts, email sending, live bank feeds, or eTIMS submission as available features.
