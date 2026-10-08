-- What a printed invoice, estimate or receipt carries besides the figures:
-- how to pay (bank account, M-Pesa paybill or till) and a short footer line,
-- set once per organization in Settings.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS payment_details TEXT,
  ADD COLUMN IF NOT EXISTS document_footer TEXT;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_payment_details_length_check CHECK (payment_details IS NULL OR length(payment_details) <= 1000),
  ADD CONSTRAINT organizations_document_footer_length_check CHECK (document_footer IS NULL OR length(document_footer) <= 500);

-- Rollback: drop the two constraints and the two columns.
