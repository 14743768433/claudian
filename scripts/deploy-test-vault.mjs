#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_PLUGIN_DIR = path.join(
  ROOT,
  'ai-tutor-test-vault',
  '.obsidian',
  'plugins',
  'claudian-ai-tutor',
);
const REQUIRED_FILES = ['main.js', 'styles.css', 'manifest.json'];

const pluginDir = resolvePluginDir(process.argv.slice(2));

fs.mkdirSync(pluginDir, { recursive: true });

for (const fileName of REQUIRED_FILES) {
  const builtPath = path.join(ROOT, fileName);
  if (!fs.existsSync(builtPath)) {
    process.stderr.write(`Missing build output: ${relative(builtPath)}. Run npm run build first.\n`);
    process.exit(1);
  }
  fs.copyFileSync(builtPath, path.join(pluginDir, fileName));
}

const verify = spawnSync(
  process.execPath,
  [
    path.join(ROOT, 'scripts', 'verify-test-vault-deploy.mjs'),
    '--plugin-dir',
    pluginDir,
  ],
  {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  },
);

if (verify.stdout) process.stdout.write(verify.stdout);
if (verify.stderr) process.stderr.write(verify.stderr);
if (verify.status !== 0) process.exit(verify.status ?? 1);

process.stdout.write(`AI Tutor plugin deployed to ${relative(pluginDir)}\n`);

function resolvePluginDir(args) {
  const vaultFlagIndex = args.indexOf('--vault');
  if (vaultFlagIndex >= 0) {
    const vaultPath = args[vaultFlagIndex + 1];
    if (!vaultPath) {
      process.stderr.write('Usage: npm run learning:deploy-test-vault -- --vault <vault-root>\n');
      process.exit(2);
    }
    return path.resolve(vaultPath, '.obsidian', 'plugins', 'claudian-ai-tutor');
  }

  const pluginFlagIndex = args.indexOf('--plugin-dir');
  if (pluginFlagIndex >= 0) {
    const pluginPath = args[pluginFlagIndex + 1];
    if (!pluginPath) {
      process.stderr.write('Usage: npm run learning:deploy-test-vault -- --plugin-dir <plugin-dir>\n');
      process.exit(2);
    }
    return path.resolve(pluginPath);
  }

  return DEFAULT_PLUGIN_DIR;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/') || '.';
}
