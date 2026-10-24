import assert from 'node:assert/strict';
import test from 'node:test';
import { shareMessage, whatsAppLink } from './invoiceShare.ts';

test('the share message names the invoice, what is due and the link', () => {
  assert.equal(
    shareMessage('Acme Ltd', 'Riverside Hardware', 'INV-2026-00012', 'KES', 1_160_050, 'https://x.test/pay/abc'),
    'Hello Acme Ltd, here is invoice INV-2026-00012 for KES 11,600.50 from Riverside Hardware. You can see it, save it and pay by M-Pesa here: https://x.test/pay/abc',
  );
  assert.equal(
    shareMessage(' ', 'Riverside Hardware', 'INV-1', 'KES', 0, 'https://x.test/pay/abc'),
    'Hello, here is invoice INV-1 from Riverside Hardware. You can see it, save it and pay by M-Pesa here: https://x.test/pay/abc',
  );
});

test('the WhatsApp link opens the customer\'s chat when the number is known', () => {
  assert.equal(whatsAppLink('254712345678', 'Hi & bye'), 'https://wa.me/254712345678?text=Hi%20%26%20bye');
  assert.equal(whatsAppLink(null, 'Hi'), 'https://wa.me/?text=Hi');
});
