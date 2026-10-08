import { DocumentPrintService } from '../../src/server/documentPrint';
import { PRINT_KINDS, type PrintKind } from '../../src/utils/printDocument';
import { respondError, UserError } from '../http';
import { uuid } from '../schemas';
import type { Api } from './types';

const printKind = (value: unknown): PrintKind => {
  if (typeof value !== 'string' || !(PRINT_KINDS as readonly string[]).includes(value)) {
    throw new UserError('Invoices, credit notes, estimates, sales receipts, sales orders and purchase orders can be printed.', 404);
  }
  return value as PrintKind;
};

/** A document laid out for printing; the browser makes the PDF from it. */
export function registerDocumentRoutes(api: Api) {
  api.get('/documents/:kind/:id', async (c) => {
    try {
      const document = await DocumentPrintService.printModel(c.get('orgId'), printKind(c.req.param('kind')), uuid.parse(c.req.param('id')));
      return c.json({ document });
    } catch (err) { return respondError(c, err); }
  });
}
