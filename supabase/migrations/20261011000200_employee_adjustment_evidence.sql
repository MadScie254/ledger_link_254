-- Relief rules extend each immutable statutory version without rewriting it.
CREATE TABLE public.statutory_adjustment_rules (
  version TEXT NOT NULL REFERENCES public.statutory_rate_tables(version) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('REGISTERED_PENSION', 'MORTGAGE_INTEREST', 'POST_RETIREMENT_MEDICAL', 'INSURANCE_PREMIUM', 'DISABILITY_EXEMPTION')),
  effective_from DATE NOT NULL,
  monthly_cap_cents BIGINT NOT NULL CHECK (monthly_cap_cents >= 0),
  relief_rate NUMERIC NOT NULL CHECK (relief_rate >= 0 AND relief_rate <= 1),
  source TEXT NOT NULL CHECK (length(btrim(source)) > 0),
  verified BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (version, adjustment_type)
);
INSERT INTO public.statutory_adjustment_rules
  (version, adjustment_type, effective_from, monthly_cap_cents, relief_rate, source, verified)
SELECT table_row.version, rule.type, table_row.effective_from, rule.cap, rule.rate, rule.source, false
FROM public.statutory_rate_tables AS table_row
CROSS JOIN (VALUES
  ('REGISTERED_PENSION', 3000000::bigint, 1::numeric, 'KRA simplified PAYE guide, page 2: monthly pension cap covers NSSF and other pension contributions. https://www.kra.go.ke/images/publications/STEP-BY-STEP-GUIDE-FOR-THE-SIMPLIFIED-PAYE-RETURN.pdf'),
  ('MORTGAGE_INTEREST', 3000000, 1, 'KRA notice, 19 December 2024: owner-occupied mortgage interest monthly deduction limit. https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024'),
  ('POST_RETIREMENT_MEDICAL', 1500000, 1, 'KRA notice, 19 December 2024: post-retirement medical fund monthly contribution limit. https://www.kra.go.ke/news-center/public-notices/2157-amendments-to-paye-computation-pursuant-to-the-tax-laws-amendment-act,-2024'),
  ('INSURANCE_PREMIUM', 500000, 0.15, 'KRA P9 template 2025, note 2(f): insurance premium relief and monthly maximum. https://www.kra.go.ke/images/publications/P9-FORM-Template-2025.pdf'),
  ('DISABILITY_EXEMPTION', 15000000, 1, 'KRA notice, 11 March 2024: monthly income exemption with a valid disability exemption certificate. https://www.kra.go.ke/news-center/public-notices/2095-income-tax-exemption-for-persons-with-disability')
) AS rule(type, cap, rate, source);

CREATE OR REPLACE FUNCTION private.protect_used_adjustment_rules()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_runs WHERE rate_version = CASE WHEN TG_OP = 'INSERT' THEN NEW.version ELSE OLD.version END)
    OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.payroll_runs WHERE rate_version = NEW.version)) THEN
    RAISE EXCEPTION 'Relief rules for a version used by payroll cannot be changed.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.protect_used_adjustment_rules() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_used_adjustment_rules BEFORE INSERT OR UPDATE OR DELETE ON public.statutory_adjustment_rules
  FOR EACH ROW EXECUTE FUNCTION private.protect_used_adjustment_rules();
ALTER TABLE public.statutory_adjustment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY statutory_adjustment_rules_read ON public.statutory_adjustment_rules FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.statutory_adjustment_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.statutory_adjustment_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_adjustment_rules TO service_role;

ALTER TABLE public.attachments DROP CONSTRAINT attachments_record_type_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_record_type_check CHECK (record_type IN (
  'INVOICE', 'BILL', 'CASH_TRANSACTION', 'CREDIT_NOTE', 'PURCHASE_ORDER', 'ESTIMATE', 'SALES_ORDER',
  'JOURNAL_ENTRY', 'CUSTOMER', 'VENDOR', 'BANK_TRANSACTION', 'EMPLOYEE'
));

CREATE TABLE public.employee_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('REGISTERED_PENSION', 'MORTGAGE_INTEREST', 'POST_RETIREMENT_MEDICAL', 'INSURANCE_PREMIUM', 'DISABILITY_EXEMPTION')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 9007199254740),
  valid_from DATE NOT NULL,
  valid_to DATE,
  reference_number TEXT NOT NULL CHECK (length(btrim(reference_number)) BETWEEN 1 AND 100),
  attachment_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, employee_id) REFERENCES public.employees(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, attachment_id) REFERENCES public.attachments(org_id, id) ON DELETE RESTRICT,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX employee_adjustments_employee ON public.employee_adjustments(org_id, employee_id, valid_from);
ALTER TABLE public.employee_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_adjustments_read ON public.employee_adjustments FOR SELECT USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.employee_adjustments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.employee_adjustments TO service_role;

CREATE OR REPLACE FUNCTION private.check_employee_adjustment_evidence()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.attachments WHERE org_id = NEW.org_id AND id = NEW.attachment_id
      AND record_type = 'EMPLOYEE' AND record_id = NEW.employee_id
  ) THEN RAISE EXCEPTION 'Evidence must be attached to this employee.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.check_employee_adjustment_evidence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER check_employee_adjustment_evidence BEFORE INSERT OR UPDATE ON public.employee_adjustments
  FOR EACH ROW EXECUTE FUNCTION private.check_employee_adjustment_evidence();

ALTER TABLE public.payslips ADD COLUMN applied_adjustments JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(applied_adjustments) = 'array');

CREATE OR REPLACE FUNCTION private.validate_payroll_adjustments(p_org UUID, p_employee UUID, p_date DATE, p_records JSONB)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE v_item JSONB;
BEGIN
  IF jsonb_typeof(p_records) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Applied adjustments must be an array.' USING ERRCODE = '23514';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.employee_adjustments AS evidence
      WHERE evidence.org_id = p_org AND evidence.employee_id = p_employee
        AND evidence.id = (v_item->>'id')::uuid AND evidence.adjustment_type = v_item->>'type'
        AND evidence.amount_cents = (v_item->>'amountCents')::bigint
        AND evidence.reference_number = v_item->>'referenceNumber'
        AND evidence.valid_from <= p_date AND (evidence.valid_to IS NULL OR evidence.valid_to >= p_date))
      OR COALESCE((v_item->>'appliedCents')::bigint, -1) < 0
      OR (v_item->>'appliedCents')::bigint > (v_item->>'amountCents')::bigint THEN
      RAISE EXCEPTION 'Applied relief does not match employee evidence in force on the pay date.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION private.validate_payroll_adjustments(UUID, UUID, DATE, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.validate_payroll_adjustments(UUID, UUID, DATE, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION private.audit_employee_adjustment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, details)
  VALUES (NEW.org_id, private.request_actor(), CASE WHEN TG_OP = 'INSERT' THEN 'CREATE' ELSE 'UPDATE' END,
    'EMPLOYEE_ADJUSTMENT', NEW.id, jsonb_build_object('employeeId', NEW.employee_id, 'type', NEW.adjustment_type,
    'amountCents', NEW.amount_cents, 'validFrom', NEW.valid_from, 'validTo', NEW.valid_to));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.audit_employee_adjustment() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER audit_employee_adjustment AFTER INSERT OR UPDATE ON public.employee_adjustments
  FOR EACH ROW EXECUTE FUNCTION private.audit_employee_adjustment();

CREATE OR REPLACE FUNCTION private.protect_payslip_adjustment_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.applied_adjustments IS DISTINCT FROM OLD.applied_adjustments THEN
    RAISE EXCEPTION 'A posted payslip adjustment snapshot cannot be changed.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.protect_payslip_adjustment_snapshot() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_payslip_adjustment_snapshot BEFORE UPDATE ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION private.protect_payslip_adjustment_snapshot();
