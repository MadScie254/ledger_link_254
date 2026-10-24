import { printedMoney } from './printDocument.ts';

/** The message that goes with an invoice link, in plain words. */
export function shareMessage(customerName: string, companyName: string, invoiceNo: string, currency: string, dueCents: number, url: string): string {
  const greeting = customerName.trim() ? `Hello ${customerName.trim()}, ` : 'Hello, ';
  const due = dueCents > 0 ? ` for ${currency} ${printedMoney(dueCents)}` : '';
  return `${greeting}here is invoice ${invoiceNo}${due} from ${companyName}. You can see it, save it and pay by M-Pesa here: ${url}`;
}

/** A WhatsApp link to that message: to the customer's chat when their number is known. */
export function whatsAppLink(phone254: string | null, message: string): string {
  return `https://wa.me/${phone254 ?? ''}?text=${encodeURIComponent(message)}`;
}
