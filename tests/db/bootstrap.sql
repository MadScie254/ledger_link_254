SET client_min_messages = warning;
DROP DATABASE IF EXISTS lltest WITH (FORCE);
CREATE DATABASE lltest;
\c lltest
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, email_confirmed_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN PASSWORD 'local-test-only' NOINHERIT;
  END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
ALTER ROLE service_role BYPASSRLS;
-- A stand-in for Supabase Vault (supabase_vault): the same functions and
-- view, with the secret kept in plain text because this database is
-- throwaway. Production encrypts it.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text NOT NULL DEFAULT '', secret text NOT NULL, key_id uuid, nonce bytea, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce, created_at, updated_at FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE sql AS $$ INSERT INTO vault.secrets (secret, name, description, key_id) VALUES (new_secret, new_name, COALESCE(new_description, ''), new_key_id) RETURNING id $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = COALESCE(new_secret, secret), name = COALESCE(new_name, name), description = COALESCE(new_description, description), key_id = COALESCE(new_key_id, key_id), updated_at = now() WHERE id = secret_id $$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
