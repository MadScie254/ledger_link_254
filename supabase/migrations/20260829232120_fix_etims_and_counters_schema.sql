-- etims_submissions.org_id/invoice_id and document_counters.org_id were typed as `text` with no
-- foreign key constraints, unlike every other table in the schema (uuid + FK to organizations).
-- Both tables also had RLS enabled with zero policies, silently blocking all API access. Fixing
-- types, adding FKs, and adding proper org-scoped policies (both tables are append-only logs,
-- like audit_logs and journal_lines: insert + select only, no update/delete via the API).

ALTER TABLE public.etims_submissions
  ALTER COLUMN org_id TYPE uuid USING org_id::uuid,
  ALTER COLUMN invoice_id TYPE uuid USING invoice_id::uuid;

ALTER TABLE public.etims_submissions
  ADD CONSTRAINT etims_submissions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD CONSTRAINT etims_submissions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;

CREATE POLICY etims_submissions_select_policy ON public.etims_submissions
  FOR SELECT USING (public.user_has_org_access(org_id));

CREATE POLICY etims_submissions_insert_policy ON public.etims_submissions
  FOR INSERT WITH CHECK (public.user_has_org_access(org_id));

ALTER TABLE public.document_counters
  ALTER COLUMN org_id TYPE uuid USING org_id::uuid;

ALTER TABLE public.document_counters
  ADD CONSTRAINT document_counters_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE POLICY document_counters_select_policy ON public.document_counters
  FOR SELECT USING (public.user_has_org_access(org_id));
-- No insert/update/delete policy: writes only ever happen through the SECURITY DEFINER
-- increment_and_get() function fixed above, which bypasses RLS deliberately and safely.

CREATE INDEX IF NOT EXISTS idx_etims_submissions_org_id ON public.etims_submissions(org_id);
CREATE INDEX IF NOT EXISTS idx_etims_submissions_invoice_id ON public.etims_submissions(invoice_id);
