#!/usr/bin/env node
/**
 * Runs vitest with `--no-experimental-webstorage` set via NODE_OPTIONS, but
 * only on Node versions that actually support that flag (22+). Node's
 * NODE_OPTIONS allowlist rejects unrecognized flags outright, so setting it
 * unconditionally breaks CI, which pins an older Node version than local
 * dev (see .nvmrc vs .github/workflows/ci.yml).
 *
 * The flag itself works around a conflict between Node 22+'s experimental
 * Web Storage API and jsdom's own localStorage implementation (same issue
 * documented in README.md for the `sandbox` script).
 */
import { spawnSync } from 'node:child_process';

const [major] = process.versions.node.split('.').map(Number);
const needsFlag = major >= 22;

const existing = process.env.NODE_OPTIONS ?? '';
const nodeOptions = needsFlag
  ? `${existing} --no-experimental-webstorage`.trim()
  : existing;

const result = spawnSync('npx', ['vitest', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

process.exit(result.status ?? 1);
