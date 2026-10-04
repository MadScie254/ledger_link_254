import { AttachmentService, ATTACHMENT_RECORDS, type AttachmentRecordType } from '../../src/server/attachments';
import { respondError, UserError } from '../http';
import { uuid } from '../schemas';
import type { Api } from './types';

const recordType = (value: unknown): AttachmentRecordType => {
  if (typeof value !== 'string' || !(value in ATTACHMENT_RECORDS)) throw new UserError('Files attach to documents, customers, suppliers and statement lines.');
  return value as AttachmentRecordType;
};

/** Files attached to records: listed, added, downloaded and removed. */
export function registerAttachmentRoutes(api: Api) {
  api.get('/attachments', async (c) => {
    try {
      return c.json({ attachments: await AttachmentService.list(c.get('orgId'), recordType(c.req.query('recordType')), uuid.parse(c.req.query('recordId'))) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/attachments', async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) throw new UserError('Choose a file to attach.');
      const attachment = await AttachmentService.upload(
        c.get('orgId'), recordType(body.recordType), uuid.parse(body.recordId),
        { name: file.name || 'attachment', bytes: new Uint8Array(await file.arrayBuffer()) }, c.get('userId'),
      );
      return c.json({ attachment }, 201);
    } catch (err) { return respondError(c, err); }
  });

  api.get('/attachments/:id/download', async (c) => {
    try {
      const file = await AttachmentService.download(c.get('orgId'), uuid.parse(c.req.param('id')));
      const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      return new Response(file.bytes, {
        headers: {
          'Content-Type': file.contentType,
          'Content-Length': String(file.bytes.length),
          // Always a download, never shown in the app's own origin.
          'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (err) { return respondError(c, err); }
  });

  api.delete('/attachments/:id', async (c) => {
    try {
      await AttachmentService.remove(c.get('orgId'), uuid.parse(c.req.param('id')));
      return c.json({ success: true });
    } catch (err) { return respondError(c, err); }
  });
}
