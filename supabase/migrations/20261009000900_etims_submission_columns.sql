-- The live etims_submissions table predates the migration history, and its
-- shape is not the "legacy shape" 20260829232120 assumed: it records
-- control_code where the app reads kra_control_code, and has no details
-- column. Printing an invoice selects kra_control_code, so on the live
-- project the print model failed. Add the columns the app uses and carry over
-- any control code already recorded. On a database built from these
-- migrations the columns exist and this changes nothing.

ALTER TABLE public.etims_submissions ADD COLUMN IF NOT EXISTS details JSONB;
ALTER TABLE public.etims_submissions ADD COLUMN IF NOT EXISTS kra_control_code TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'etims_submissions' AND column_name = 'control_code'
  ) THEN
    UPDATE public.etims_submissions
       SET kra_control_code = control_code
     WHERE kra_control_code IS NULL AND control_code IS NOT NULL;
  END IF;
END $$;
