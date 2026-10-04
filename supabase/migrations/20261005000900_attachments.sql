-- Files attached to records: the receipt behind an expense, the supplier's
-- bill as a PDF, a signed delivery note on an invoice, a contract on a
-- customer. The Worker checks the type and size (5 MB at most), that the
-- record is the organization's, and serves files back only as downloads.
--
-- Contents are kept in Postgres, apart from the list of files, so listing
-- never reads them. Removing a file is audited with its name and checksum.

CREATE TABLE public.attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_type   TEXT NOT NULL,
  record_id     UUID NOT NULL,
  file_name     TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  uploaded_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attachments_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT attachments_record_type_check CHECK (record_type IN (
    'INVOICE', 'BILL', 'CASH_TRANSACTION', 'CREDIT_NOTE', 'PURCHASE_ORDER', 'ESTIMATE', 'SALES_ORDER',
    'JOURNAL_ENTRY', 'CUSTOMER', 'VENDOR', 'BANK_TRANSACTION'
  )),
  CONSTRAINT attachments_file_name_check CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
  CONSTRAINT attachments_content_type_check CHECK (content_type ~ '^[a-z]+/[a-z0-9.+-]+$' AND length(content_type) <= 100),
  CONSTRAINT attachments_size_check CHECK (size_bytes BETWEEN 1 AND 5242880),
  CONSTRAINT attachments_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.attachment_contents (
  attachment_id UUID PRIMARY KEY,
  org_id        UUID NOT NULL,
  content       BYTEA NOT NULL,
  CONSTRAINT attachment_contents_parent_fkey FOREIGN KEY (org_id, attachment_id)
    REFERENCES public.attachments(org_id, id) ON DELETE CASCADE,
  CONSTRAINT attachment_contents_size_check CHECK (octet_length(content) BETWEEN 1 AND 5242880)
);

CREATE INDEX idx_attachments_record ON public.attachments(org_id, record_type, record_id, created_at);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_contents ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachments_select_policy ON public.attachments
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
CREATE POLICY attachment_contents_select_policy ON public.attachment_contents
  FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON TABLE public.attachments, public.attachment_contents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.attachments, public.attachment_contents TO service_role;

-- Adding and removing a file is audited; the audit row keeps the name and
-- checksum, not the contents.
CREATE OR REPLACE FUNCTION private.audit_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.attachments;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (
    v_row.org_id, private.request_actor(), CASE WHEN TG_OP = 'DELETE' THEN 'DETACH' ELSE 'ATTACH' END,
    v_row.record_type, v_row.record_id,
    jsonb_build_object('attachmentId', v_row.id, 'fileName', v_row.file_name, 'sizeBytes', v_row.size_bytes, 'sha256', v_row.sha256)
  );
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.audit_attachment() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS attachments_audit ON public.attachments;
CREATE TRIGGER attachments_audit AFTER INSERT OR DELETE ON public.attachments
  FOR EACH ROW EXECUTE FUNCTION private.audit_attachment();

-- Rollback: drop the trigger, private.audit_attachment,
-- public.attachment_contents and public.attachments.
