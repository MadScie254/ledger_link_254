#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'supabase', 'migrations');

async function readStdin(): Promise<string> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk.toString();
  return input;
}

function remoteVersionsFromCli(output: string): Set<string> {
  const versions = new Set<string>();
  let rows = 0;

  for (const line of output.split(/\r?\n/)) {
    const [local = '', remote = ''] = line.split('|').map((column) => column.trim());
    if (!/^\d{14}$|^$/.test(local) || !/^\d{14}$|^$/.test(remote)) continue;
    if (!local && !remote) continue;
    rows += 1;
    if (remote) versions.add(remote);
  }

  if (rows === 0) {
    throw new Error('No migration rows found in Supabase CLI output. Pipe `supabase migration list` into this script.');
  }
  return versions;
}

const filenames = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
const malformed = filenames.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
if (malformed.length > 0) {
  throw new Error(`Invalid migration filenames: ${malformed.join(', ')}`);
}

const localByVersion = new Map(filenames.map((name) => [name.slice(0, 14), name]));
if (localByVersion.size !== filenames.length) {
  throw new Error('Two local migration files have the same version.');
}

const remoteVersions = remoteVersionsFromCli(await readStdin());
const missingRemote = [...localByVersion.keys()].filter((version) => !remoteVersions.has(version)).sort();
const missingLocal = [...remoteVersions].filter((version) => !localByVersion.has(version)).sort();

if (missingRemote.length || missingLocal.length) {
  if (missingRemote.length) {
    console.error('Local migrations missing from remote:');
    for (const version of missingRemote) console.error(`  ${localByVersion.get(version)}`);
  }
  if (missingLocal.length) {
    console.error('Remote migrations missing from this repository:');
    for (const version of missingLocal) console.error(`  ${version}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Migration histories match (${localByVersion.size} versions).`);
}
