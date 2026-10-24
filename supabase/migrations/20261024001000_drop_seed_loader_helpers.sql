-- Removes the helpers that loaded the demo organizations into production.
--
-- The demo data was replayed into the live project once, outside the
-- migrations, through seven plpgsql helpers in the private schema and a
-- staging table holding the recorded SQL. They have no search_path set (the
-- Supabase advisor flags each one), nothing calls them, and no API role can
-- run them. The demo rows they wrote stay where they are: they live in the
-- ordinary tables and depend on none of this.
--
-- On a database built from these migrations alone the objects never existed,
-- so each drop does nothing.

DROP FUNCTION IF EXISTS private.ll_insert(TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS private.ll_locate(JSONB);
DROP FUNCTION IF EXISTS private.ll_patch(TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS private.ll_rpc(TEXT, JSONB);
DROP FUNCTION IF EXISTS private.ll_sig(JSONB, JSONB);
DROP FUNCTION IF EXISTS private.ll_subst(JSONB);
DROP FUNCTION IF EXISTS private.ll_walk(JSONB, JSONB, TEXT);
DROP TABLE IF EXISTS private.ll_seed_stage;

-- Rollback: none needed. The helpers served a one-time load that is done.
