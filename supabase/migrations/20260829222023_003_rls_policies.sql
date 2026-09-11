-- ============================================================
-- LedgerLink Migration 003: Row Level Security (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user has access to org
CREATE OR REPLACE FUNCTION public.user_has_org_access(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships 
    WHERE org_id = check_org_id 
    AND user_id = auth.uid()
  );
$$;

-- Helper function to check if user has admin/owner role in org
CREATE OR REPLACE FUNCTION public.user_is_org_admin(check_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships 
    WHERE org_id = check_org_id 
    AND user_id = auth.uid()
    AND role IN ('admin', 'owner')
  );
$$;

-- ─── memberships policies ──────────────────────────────────────────────────
-- Users can see memberships for orgs they belong to
CREATE POLICY memberships_select_policy ON public.memberships
  FOR SELECT USING (user_has_org_access(org_id));

-- Only admins/owners can insert/update/delete memberships
CREATE POLICY memberships_insert_policy ON public.memberships
  FOR INSERT WITH CHECK (user_is_org_admin(org_id));
  
CREATE POLICY memberships_update_policy ON public.memberships
  FOR UPDATE USING (user_is_org_admin(org_id));
  
CREATE POLICY memberships_delete_policy ON public.memberships
  FOR DELETE USING (user_is_org_admin(org_id));

-- ─── organizations policies ────────────────────────────────────────────────
-- Users can see orgs they are members of
CREATE POLICY organizations_select_policy ON public.organizations
  FOR SELECT USING (
    id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

-- Only owners/admins can update org details
CREATE POLICY organizations_update_policy ON public.organizations
  FOR UPDATE USING (user_is_org_admin(id));

-- Anyone can create an org (they should be added as owner via trigger/rpc)
CREATE POLICY organizations_insert_policy ON public.organizations
  FOR INSERT WITH CHECK (true);

-- ─── base policy generator ─────────────────────────────────────────────────
-- Apply standard select policy to all tenant tables
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN 
    SELECT t.table_name FROM information_schema.tables t
    WHERE t.table_schema = 'public' 
    AND t.table_name IN (
      'accounts', 'journal_entries', 'customers', 'vendors', 
      'invoices', 'bills', 'bank_transactions', 'employees', 
      'inventory_items', 'projects', 'audit_logs'
    )
  LOOP
    EXECUTE format('
      CREATE POLICY %1$s_select_policy ON public.%1$s
        FOR SELECT USING (user_has_org_access(org_id));
        
      CREATE POLICY %1$s_insert_policy ON public.%1$s
        FOR INSERT WITH CHECK (user_has_org_access(org_id));
        
      CREATE POLICY %1$s_update_policy ON public.%1$s
        FOR UPDATE USING (user_has_org_access(org_id));
    ', table_name);
  END LOOP;
END
$$;

-- Special delete policies (only admin/owner can delete financial core records)
CREATE POLICY accounts_delete_policy ON public.accounts FOR DELETE USING (user_is_org_admin(org_id));
CREATE POLICY journal_entries_delete_policy ON public.journal_entries FOR DELETE USING (user_is_org_admin(org_id));

-- Standard deletes for other tables
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN 
    SELECT t.table_name FROM information_schema.tables t
    WHERE t.table_schema = 'public' 
    AND t.table_name IN (
      'customers', 'vendors', 'invoices', 'bills', 
      'bank_transactions', 'employees', 'inventory_items', 'projects'
    )
  LOOP
    EXECUTE format('
      CREATE POLICY %1$s_delete_policy ON public.%1$s
        FOR DELETE USING (user_has_org_access(org_id));
    ', table_name);
  END LOOP;
END
$$;

-- audit logs are insert/select only
CREATE POLICY audit_logs_delete_policy ON public.audit_logs FOR DELETE USING (false);

-- journal_lines inherits from journal_entries
CREATE POLICY journal_lines_select_policy ON public.journal_lines
  FOR SELECT USING (
    journal_entry_id IN (
      SELECT id FROM public.journal_entries 
      WHERE user_has_org_access(org_id)
    )
  );

CREATE POLICY journal_lines_insert_policy ON public.journal_lines
  FOR INSERT WITH CHECK (
    journal_entry_id IN (
      SELECT id FROM public.journal_entries 
      WHERE user_has_org_access(org_id)
    )
  );
