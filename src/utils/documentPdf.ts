import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { latin1, printedMoney, printedQuantity, type PrintDocument } from './printDocument.ts';

type Rgb = [number, number, number];

// DESIGN.md: printer's ink for text and totals, graphite for labels, feint
// ruling between rows, stationery red ruling the total, auditor's green for
// a paid stamp. The company's accent is its binding: the band and its name.
const INK: Rgb = [26, 29, 36];
const GRAPHITE: Rgb = [75, 83, 97];
const FEINT: Rgb = [213, 224, 238];
const FEINT_STRONG: Rgb = [169, 190, 218];
const LEDGER_RED: Rgb = [179, 32, 47];
const AUDITOR_GREEN: Rgb = [30, 107, 69];

const MARGIN = 16;
const FOOTER_SPACE = 22;

function rgbOf(hex: string, fallback: Rgb): Rgb {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : fallback;
}

/** Lines of text, each wrapped to the width, user text made drawable first. */
function wrapped(doc: jsPDF, values: Array<string | null | undefined>, width: number): string[] {
  return values
    .filter((value): value is string => Boolean(value && value.trim()))
    .flatMap((value) => latin1(value).split(/\r?\n/))
    .flatMap((line) => doc.splitTextToSize(line, width) as string[]);
}

/**
 * The PDF of a printed document, one A4 page or more: the company and the
 * document heading, who it is for and its dates, the lines, the totals ruled
 * as in the book, then notes, how to pay and the eTIMS signature. Builds the
 * file only; the caller saves or attaches it.
 */
export function buildDocumentPdf(model: PrintDocument): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const right = width - MARGIN;
  const accent = rgbOf(model.accent, [90, 26, 31]);
  const money = (cents: number) => printedMoney(cents);
  doc.setProperties({
    title: latin1(`${model.title} ${model.number}`),
    subject: latin1(model.title),
    author: latin1(model.company.name),
    creator: 'Ledger Link',
  });

  const label = (text: string, x: number, y: number, align: 'left' | 'right' = 'left') => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...GRAPHITE);
    doc.text(latin1(text).toUpperCase(), x, y, { align });
  };

  // The binding band, then the company on the left.
  doc.setFillColor(...accent);
  doc.rect(MARGIN, MARGIN - 6, width - MARGIN * 2, 1.4, 'F');
  let y = MARGIN + 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...accent);
  const nameLines = doc.splitTextToSize(latin1(model.company.name), 108) as string[];
  doc.text(nameLines, MARGIN, y);
  y += (nameLines.length - 1) * 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAPHITE);
  const { company } = model;
  for (const line of wrapped(doc, [
    company.legalName,
    company.address,
    company.city,
    [company.phone, company.email].filter(Boolean).join('  ·  '),
    company.website,
    company.taxId ? `KRA PIN ${company.taxId}` : null,
  ], 108)) {
    y += 4;
    doc.text(line, MARGIN, y);
  }

  // The document's own heading on the right.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(latin1(model.title), right, MARGIN + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...GRAPHITE);
  doc.text(latin1(model.number), right, MARGIN + 10, { align: 'right' });
  doc.setFontSize(8);
  doc.text(`Amounts in ${latin1(model.currency)}`, right, MARGIN + 15, { align: 'right' });

  y = Math.max(y, MARGIN + 15) + 5;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, right, y);
  y += 7;

  // Who it is for on the left, its dates and references on the right.
  const blockTop = y;
  let partyY = y;
  if (model.party) {
    label(model.partyLabel, MARGIN, partyY);
    partyY += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    const partyName = doc.splitTextToSize(latin1(model.party.name), 95) as string[];
    doc.text(partyName, MARGIN, partyY);
    partyY += (partyName.length - 1) * 4.6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAPHITE);
    const { party } = model;
    for (const line of wrapped(doc, [
      party.legalName,
      party.address,
      party.city,
      party.kraPin ? `KRA PIN ${party.kraPin}` : null,
      [party.phone, party.email].filter(Boolean).join('  ·  '),
    ], 95)) {
      partyY += 4;
      doc.text(line, MARGIN, partyY);
    }
  }
  let factsY = blockTop;
  for (const fact of model.facts) {
    label(fact.label, right - 46, factsY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(latin1(fact.value), right, factsY, { align: 'right' });
    factsY += 5.5;
  }
  if (model.stamp) {
    const colour = model.stamp === 'PAID' ? AUDITOR_GREEN : LEDGER_RED;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(...colour);
    doc.text(model.stamp, width / 2 + 2, blockTop + 13, { angle: 12 });
  }
  y = Math.max(partyY, factsY - 5.5, blockTop + 14) + 8;

  // The lines.
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE, top: MARGIN },
    head: [['Description', 'Qty', model.priceLabel, 'VAT %', 'VAT', 'Amount'].map((heading) => heading.toUpperCase())],
    // A line under a new heading (professional fees, disbursements) opens with that heading.
    body: model.lines.flatMap((line, index) => {
      const row = [
        latin1(line.description),
        printedQuantity(line.quantity),
        line.unitPriceCents == null ? '' : money(line.unitPriceCents),
        line.taxRate == null ? '' : `${line.taxRate}%`,
        money(line.taxCents),
        money(line.amountCents),
      ];
      const heading = line.section && line.section !== model.lines[index - 1]?.section
        ? [[{ content: latin1(line.section).toUpperCase(), colSpan: 6, styles: { fontStyle: 'bold', fontSize: 7, textColor: GRAPHITE, cellPadding: { top: 3.5, bottom: 1.2, left: 1.5, right: 1.5 } } }]]
        : [];
      return [...heading, row] as any[];
    }),
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      textColor: INK,
      cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
      lineColor: FEINT,
      lineWidth: { bottom: 0.2 },
      overflow: 'linebreak',
    },
    headStyles: { fontStyle: 'bold', fontSize: 7, textColor: GRAPHITE, lineColor: FEINT_STRONG, lineWidth: { bottom: 0.4 } },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 14 },
      2: { halign: 'right', cellWidth: 26 },
      3: { halign: 'right', cellWidth: 15 },
      4: { halign: 'right', cellWidth: 24 },
      5: { halign: 'right', cellWidth: 28 },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right';
    },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 7;

  const roomFor = (needed: number) => {
    if (y + needed > height - FOOTER_SPACE) {
      doc.addPage();
      y = MARGIN + 4;
    }
  };

  // The totals, ruled as in the book: one red rule above the total, two below.
  const totalsLeft = right - 82;
  roomFor(model.totals.length * 6.5 + 6);
  for (const total of model.totals) {
    const strong = Boolean(total.emphasis);
    if (total.emphasis === 'total') {
      doc.setDrawColor(...LEDGER_RED);
      doc.setLineWidth(0.3);
      doc.line(totalsLeft, y - 4, right, y - 4);
    }
    doc.setFont('helvetica', strong ? 'bold' : 'normal');
    doc.setFontSize(total.emphasis === 'balance' ? 10.5 : 9);
    doc.setTextColor(...(strong ? INK : GRAPHITE));
    doc.text(latin1(total.label), totalsLeft, y);
    doc.setTextColor(...INK);
    const figure = total.emphasis ? `${latin1(model.currency)} ${money(total.cents)}` : money(total.cents);
    doc.text(figure, right, y, { align: 'right' });
    if (total.emphasis === 'total') {
      doc.setDrawColor(...LEDGER_RED);
      doc.setLineWidth(0.3);
      doc.line(totalsLeft, y + 1.8, right, y + 1.8);
      doc.line(totalsLeft, y + 2.6, right, y + 2.6);
      y += 2.5;
    }
    y += 6.5;
  }
  y += 3;

  // Notes and how to pay, each under its own label.
  const writeSection = (heading: string, text: string | null) => {
    if (!text) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = wrapped(doc, [text], width - MARGIN * 2);
    roomFor(9 + Math.min(lines.length, 3) * 4.4);
    label(heading, MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    for (const line of lines) {
      roomFor(4.4);
      doc.text(line, MARGIN, y);
      y += 4.4;
    }
    y += 4;
  };
  writeSection('Notes', model.notes);
  writeSection('How to pay', model.paymentDetails);

  if (model.etims) {
    roomFor(16);
    label('KRA eTIMS', MARGIN, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(`Control unit invoice number ${latin1(model.etims.controlCode)}`, MARGIN, y);
    const verifyAt = model.etims.qrCodeUrl;
    if (verifyAt && /^https:\/\//i.test(verifyAt)) {
      y += 4.4;
      doc.setTextColor(...GRAPHITE);
      doc.textWithLink('Check this invoice with KRA', MARGIN, y, { url: verifyAt });
    }
    y += 6;
  }

  // The footer on every page: the company's own line, and where this page sits.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    const footerY = height - 12;
    doc.setDrawColor(...FEINT);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, footerY - 4, right, footerY - 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAPHITE);
    if (model.footer) {
      const footerLines = (doc.splitTextToSize(latin1(model.footer), width - MARGIN * 2 - 50) as string[]).slice(0, 2);
      doc.text(footerLines, MARGIN, footerY);
    }
    doc.text(latin1(`${model.title} ${model.number}  ·  Page ${page} of ${pages}`), right, footerY, { align: 'right' });
  }
  return doc;
}
