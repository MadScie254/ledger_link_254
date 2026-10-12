CREATE TABLE public.statement_import_layouts (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL,
  header_row INTEGER NOT NULL CHECK (header_row >= 0 AND header_row <= 10000),
  mapping JSONB NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, bank_account_id),
  FOREIGN KEY (org_id, bank_account_id) REFERENCES public.accounts(org_id, id) ON DELETE CASCADE
);
ALTER TABLE public.statement_import_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY statement_import_layouts_read ON public.statement_import_layouts FOR SELECT
  USING ((SELECT public.user_has_org_access(org_id)));
REVOKE ALL ON public.statement_import_layouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.statement_import_layouts TO service_role;

CREATE OR REPLACE FUNCTION private.check_statement_layout_money_account()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE org_id = NEW.org_id AND id = NEW.bank_account_id
    AND type = 'ASSET' AND is_bank_account) THEN
    RAISE EXCEPTION 'A statement layout needs a money account in this organization.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.check_statement_layout_money_account() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER check_statement_layout_money_account BEFORE INSERT OR UPDATE ON public.statement_import_layouts
  FOR EACH ROW EXECUTE FUNCTION private.check_statement_layout_money_account();
