import { apiRequest } from './apiRequest';
import { printFileName, type PrintDocument, type PrintKind } from './printDocument';

/**
 * Saves a document as a PDF: the Worker lays it out from the books, the
 * browser draws it. The PDF library loads only the first time one is asked
 * for. Returns the file name it was saved under.
 */
export async function downloadDocumentPdf(kind: PrintKind, id: string): Promise<string> {
  const { document } = await apiRequest<{ document: PrintDocument }>(`/api/documents/${kind}/${encodeURIComponent(id)}`, {
    fallback: 'That document could not be prepared for printing. Try again.',
  });
  const { buildDocumentPdf } = await import('./documentPdf');
  const fileName = printFileName(document);
  buildDocumentPdf(document).save(fileName);
  return fileName;
}
