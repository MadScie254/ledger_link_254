import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

export interface ReportExportOptions {
  title: string;
  subtitle?: string;
  companyName?: string;
  kraPin?: string;
  period?: string;
  currency?: string;
  filename?: string;
}

export interface PDFTableRow {
  [key: string]: any;
}

export class FinancialPDFEngine {
  /**
   * Generates a branded, physical-print-optimized financial PDF
   */
  static exportFinancialStatement(
    options: ReportExportOptions,
    sections: {
      title?: string;
      headers: string[];
      rows: (string | number)[][];
      columnStyles?: Record<number, any>;
      isSubtotal?: boolean;
    }[]
  ) {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const company = options.companyName || 'LEDGERLINE ENTERPRISES LTD';
    const kraPin = options.kraPin || 'P051239847Z';
    const currency = options.currency || 'KES';
    const period = options.period || 'Year-to-date 2026';
    const generatedDate = format(new Date(), 'dd MMMM yyyy, HH:mm');

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;

    // --- Branded Top Header Banner ---
    // Deep slate header bar
    doc.setFillColor(15, 23, 42); // #0F172A
    doc.rect(margin, margin, pageWidth - (margin * 2), 24, 'F');

    // Brass accent stripe at bottom of header banner
    doc.setFillColor(217, 119, 6); // #D97706
    doc.rect(margin, margin + 22, pageWidth - (margin * 2), 2, 'F');

    // Header Text
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(company.toUpperCase(), margin + 6, margin + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(203, 213, 225); // Slate 300
    doc.text(`KRA PIN: ${kraPin}  •  OFFICIAL FINANCIAL RECORD`, margin + 6, margin + 16);

    // Right-aligned header metadata
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(`CURRENCY: ${currency}`, pageWidth - margin - 6, margin + 9, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(203, 213, 225);
    doc.text(`Generated: ${generatedDate}`, pageWidth - margin - 6, margin + 16, { align: 'right' });

    // --- Statement Title & Period Box ---
    let currentY = margin + 32;

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(options.title.toUpperCase(), margin, currentY);

    currentY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139); // Slate 500
    doc.text(`Reporting Period: ${period} ${options.subtitle ? ` •  ${options.subtitle}` : ''}`, margin, currentY);

    currentY += 4;
    // Thin divider
    doc.setDrawColor(226, 232, 240); // Slate 200
    doc.setLineWidth(0.5);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 4;

    // --- Render Tables for Each Section ---
    sections.forEach((section) => {
      if (section.title) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text(section.title, margin, currentY + 4);
        currentY += 6;
      }

      autoTable(doc, {
        startY: currentY,
        head: [section.headers],
        body: section.rows as any,
        margin: { left: margin, right: margin },
        theme: 'plain',
        headStyles: {
          fillColor: [241, 245, 249], // #F1F5F9 Slate 100
          textColor: [51, 65, 85], // #334155 Slate 700
          fontStyle: 'bold',
          fontSize: 8.5,
          cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
          lineWidth: { bottom: 1 },
          lineColor: [203, 213, 225]
        },
        bodyStyles: {
          textColor: [30, 41, 59], // #1E293B
          fontSize: 8.5,
          cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 }
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252] // #F8FAFC
        },
        columnStyles: section.columnStyles || {
          0: { cellWidth: 'auto' },
          1: { halign: 'right', fontStyle: 'bold' }
        },
        didDrawPage: (data) => {
          // Footer on each page
          const pageCount = (doc.internal as any).getNumberOfPages ? (doc.internal as any).getNumberOfPages() : (doc as any).internal.pages.length - 1;
          const pageNum = data.pageNumber;
          const footerY = doc.internal.pageSize.getHeight() - 10;

          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.3);
          doc.line(margin, footerY - 3, pageWidth - margin, footerY - 3);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184); // Slate 400
          doc.text('Ledgerline Engine • Confidential & Legally Binding Financial Record', margin, footerY);
          doc.text(`Page ${pageNum} of ${pageCount}`, pageWidth - margin, footerY, { align: 'right' });
        }
      });

      currentY = (doc as any).lastAutoTable.finalY + 6;
    });

    // --- Sign-off Block on Final Page ---
    const pageHeight = doc.internal.pageSize.getHeight();
    if (currentY + 28 < pageHeight - 15) {
      currentY += 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      
      // Sign-off boxes
      const boxWidth = 55;
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);

      // Prepared By
      doc.line(margin, currentY + 12, margin + boxWidth, currentY + 12);
      doc.text('Prepared By / Chief Accountant', margin, currentY + 16);

      // Approved By
      const col2X = margin + 65;
      doc.line(col2X, currentY + 12, col2X + boxWidth, currentY + 12);
      doc.text('Approved By / Managing Director', col2X, currentY + 16);

      // Date / Official Stamp
      const col3X = pageWidth - margin - boxWidth;
      doc.line(col3X, currentY + 12, col3X + boxWidth, currentY + 12);
      doc.text('Date & Official Company Seal', col3X, currentY + 16);
    }

    // Save File
    const finalFilename = options.filename || `${options.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
    doc.save(finalFilename);
  }

  /**
   * Helper to format numbers with KES commas
   */
  static formatKES(cents: number): string {
    const val = cents / 100;
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
