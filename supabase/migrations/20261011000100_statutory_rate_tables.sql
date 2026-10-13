-- Shared, effective-dated payroll reference data. The JSON array keeps PAYE
-- bands in order and accepts any number of bands, including a zero-rate band.
CREATE TABLE public.statutory_rate_tables (
  version TEXT PRIMARY KEY,
  effective_from DATE NOT NULL UNIQUE,
  source TEXT NOT NULL,
  rates JSONB NOT NULL,
  CONSTRAINT statutory_rate_version_check CHECK (length(btrim(version)) BETWEEN 1 AND 60),
  CONSTRAINT statutory_rate_source_check CHECK (length(btrim(source)) > 0),
  CONSTRAINT statutory_rate_bands_check CHECK (
    COALESCE(jsonb_typeof(rates->'payeBands') = 'array', false)
    AND jsonb_array_length(rates->'payeBands') > 0
  )
);

-- These are copies of the three coded calculator fixtures, not newly verified
-- statutory values. Keep their existing source text and effective dates.
INSERT INTO public.statutory_rate_tables (version, effective_from, source, rates) VALUES
  ('KE-2024-12', '2024-12-27', 'Tax Laws (Amendment) Act 2024; NSSF Third Schedule Year 2', $rates${
    "payeBands": [{"upToCents":2400000,"rate":0.10},{"upToCents":3233300,"rate":0.25},{"upToCents":50000000,"rate":0.30},{"upToCents":80000000,"rate":0.325},{"upToCents":null,"rate":0.35}],
    "personalReliefCents":240000,
    "nssf":{"rate":0.06,"lowerEarningsLimitCents":700000,"upperEarningsLimitCents":3600000},
    "shif":{"rate":0.0275,"minimumCents":30000},
    "housingLevyRate":0.015,
    "pensionDeductionCapCents":3000000
  }$rates$::jsonb),
  ('KE-2025-02', '2025-02-01', 'NSSF Third Schedule Year 3; Tax Laws (Amendment) Act 2024', $rates${
    "payeBands": [{"upToCents":2400000,"rate":0.10},{"upToCents":3233300,"rate":0.25},{"upToCents":50000000,"rate":0.30},{"upToCents":80000000,"rate":0.325},{"upToCents":null,"rate":0.35}],
    "personalReliefCents":240000,
    "nssf":{"rate":0.06,"lowerEarningsLimitCents":800000,"upperEarningsLimitCents":7200000},
    "shif":{"rate":0.0275,"minimumCents":30000},
    "housingLevyRate":0.015,
    "pensionDeductionCapCents":3000000
  }$rates$::jsonb),
  ('KE-2026-02', '2026-02-01', 'NSSF Third Schedule Year 4; Tax Laws (Amendment) Act 2024', $rates${
    "payeBands": [{"upToCents":2400000,"rate":0.10},{"upToCents":3233300,"rate":0.25},{"upToCents":50000000,"rate":0.30},{"upToCents":80000000,"rate":0.325},{"upToCents":null,"rate":0.35}],
    "personalReliefCents":240000,
    "nssf":{"rate":0.06,"lowerEarningsLimitCents":900000,"upperEarningsLimitCents":10800000},
    "shif":{"rate":0.0275,"minimumCents":30000},
    "housingLevyRate":0.015,
    "pensionDeductionCapCents":3000000
  }$rates$::jsonb);

-- A run keeps its version. Once used, even service_role cannot alter or
-- remove that version; a new rate is a new row.
CREATE OR REPLACE FUNCTION private.protect_used_statutory_rate_table()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_runs WHERE rate_version = OLD.version) THEN
    RAISE EXCEPTION 'A statutory rate version used by payroll cannot be changed or deleted.'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.protect_used_statutory_rate_table() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_used_statutory_rate_table
  BEFORE UPDATE OR DELETE ON public.statutory_rate_tables
  FOR EACH ROW EXECUTE FUNCTION private.protect_used_statutory_rate_table();

ALTER TABLE public.statutory_rate_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY statutory_rate_tables_read ON public.statutory_rate_tables
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.statutory_rate_tables FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.statutory_rate_tables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_rate_tables TO service_role;
