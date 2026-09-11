-- Performance advisor flagged these foreign key columns as unindexed, which would cause
-- sequential scans on every join/filter against them at scale.
CREATE INDEX IF NOT EXISTS idx_accounts_parent_id ON public.accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_bills_created_by ON public.bills(created_by);
CREATE INDEX IF NOT EXISTS idx_bills_vendor_id ON public.bills(vendor_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_asset_account_id ON public.inventory_items(asset_account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_cogs_account_id ON public.inventory_items(cogs_account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_income_account_id ON public.inventory_items(income_account_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON public.invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by ON public.journal_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_customer_id ON public.projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_manager_id ON public.projects(manager_id);
