import { getSupabase } from './supabase';
import { UserError } from './errors';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_PER_RECORD = 50;

export const ATTACHMENT_RECORDS = {
  INVOICE: 'invoices',
  BILL: 'bills',
  CASH_TRANSACTION: 'cash_transactions',
  CREDIT_NOTE: 'credit_notes',
  PURCHASE_ORDER: 'purchase_orders',
  ESTIMATE: 'estimates',
  SALES_ORDER: 'sales_orders',
  JOURNAL_ENTRY: 'journal_entries',
  CUSTOMER: 'customers',
  VENDOR: 'vendors',
  BANK_TRANSACTION: 'bank_transactions',
} as const;
export type AttachmentRecordType = keyof typeof ATTACHMENT_RECORDS;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, i) => bytes[offset + i] === value);

/**
 * The file's real type, from its first bytes rather than the name or the
 * browser's word for it, or null for a type not accepted. Spreadsheets and
 * documents are zip files told apart by their extension.
 */
export function sniffContentType(bytes: Uint8Array, fileName: string): string | null {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) && /^(heic|heix|mif1|msf1)$/.test(String.fromCharCode(...bytes.slice(8, 12)))) return 'image/heic';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return null;
  }
  if ((extension === 'csv' || extension === 'txt') && !bytes.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return extension === 'csv' ? 'text/csv' : 'text/plain';
    } catch {
      return null;
    }
  }
  return null;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function fromHex(value: string): Uint8Array {
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function cleanFileName(name: string) {
  const cleaned = name.replace(/[\\/\u0000-\u001f\u007f"]/g, '_').replace(/\s+/g, ' ').trim().slice(-200);
  return cleaned || 'attachment';
}

function mapAttachment(row: any) {
  return {
    id: row.id,
    recordType: row.record_type as AttachmentRecordType,
    recordId: row.record_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

/** Files attached to the organization's records, kept in Postgres. */
export class AttachmentService {
  static async list(orgId: string, recordType: AttachmentRecordType, recordId: string) {
    const { data, error } = await getSupabase()
      .from('attachments')
      .select('id, record_type, record_id, file_name, content_type, size_bytes, uploaded_by, created_at')
      .eq('org_id', orgId)
      .eq('record_type', recordType)
      .eq('record_id', recordId)
      .order('created_at')
      .limit(MAX_PER_RECORD);
    if (error) throw error;
    return (data || []).map(mapAttachment);
  }

  static async upload(orgId: string, recordType: AttachmentRecordType, recordId: string, file: { name: string; bytes: Uint8Array }, actor: string) {
    if (file.bytes.length === 0) throw new UserError('The file is empty.');
    if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new UserError('Attach files of 5 MB or less. Photograph a receipt at a lower size, or split a long PDF.');
    const contentType = sniffContentType(file.bytes, file.name);
    if (!contentType) throw new UserError('Attach a PDF, a photo (JPEG, PNG, WebP or HEIC), a spreadsheet (XLSX or CSV) or a Word document.');

    const supabase = getSupabase();
    const [{ data: record, error: recordError }, { count, error: countError }] = await Promise.all([
      supabase.from(ATTACHMENT_RECORDS[recordType]).select('id').eq('org_id', orgId).eq('id', recordId).maybeSingle(),
      supabase.from('attachments').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('record_type', recordType).eq('record_id', recordId),
    ]);
    if (recordError) throw recordError;
    if (countError) throw countError;
    if (!record) throw new UserError('That record is not in this organization.', 404);
    if ((count || 0) >= MAX_PER_RECORD) throw new UserError(`A record holds at most ${MAX_PER_RECORD} files.`);

    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', file.bytes));
    const id = crypto.randomUUID();
    const { data, error } = await supabase
      .from('attachments')
      .insert({
        id, org_id: orgId, record_type: recordType, record_id: recordId, file_name: cleanFileName(file.name),
        content_type: contentType, size_bytes: file.bytes.length, sha256: toHex(digest), uploaded_by: actor,
      })
      .select('id, record_type, record_id, file_name, content_type, size_bytes, uploaded_by, created_at')
      .single();
    if (error) throw error;
    const { error: contentError } = await supabase
      .from('attachment_contents')
      .insert({ attachment_id: id, org_id: orgId, content: `\\x${toHex(file.bytes)}` });
    if (contentError) {
      await supabase.from('attachments').delete().eq('org_id', orgId).eq('id', id);
      throw contentError;
    }
    return mapAttachment(data);
  }

  static async download(orgId: string, id: string) {
    const supabase = getSupabase();
    const [{ data: meta, error }, { data: content, error: contentError }] = await Promise.all([
      supabase.from('attachments').select('file_name, content_type, size_bytes').eq('org_id', orgId).eq('id', id).maybeSingle(),
      supabase.from('attachment_contents').select('content').eq('org_id', orgId).eq('attachment_id', id).maybeSingle(),
    ]);
    if (error) throw error;
    if (contentError) throw contentError;
    if (!meta || !content) throw new UserError('File not found in this organization.', 404);
    return { fileName: meta.file_name as string, contentType: meta.content_type as string, bytes: fromHex(String(content.content)) };
  }

  static async remove(orgId: string, id: string) {
    const { data, error } = await getSupabase().from('attachments').delete().eq('org_id', orgId).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('File not found in this organization.', 404);
  }
}
