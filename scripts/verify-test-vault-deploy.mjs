#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
const failures = [];

for (const fileName of REQUIRED_FILES) {
  const builtPath = path.join(ROOT, fileName);
  const deployedPath = path.join(pluginDir, fileName);

  if (!fs.existsSync(builtPath)) {
    failures.push(`Missing build output: ${relative(builtPath)}`);
    continue;
  }
  if (!fs.existsSync(deployedPath)) {
    failures.push(`Missing deployed plugin file: ${relative(deployedPath)}`);
    continue;
  }

  const builtHash = sha256(builtPath);
  const deployedHash = sha256(deployedPath);
  if (builtHash !== deployedHash) {
    failures.push(`${fileName} hash mismatch: build=${builtHash} deployed=${deployedHash}`);
  }
}

if (failures.length > 0) {
  process.stderr.write('AI Tutor test vault deployment check failed:\n');
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(`AI Tutor test vault deployment matches current build: ${relative(pluginDir)}\n`);

function resolvePluginDir(args) {
  const vaultFlagIndex = args.indexOf('--vault');
  if (vaultFlagIndex >= 0) {
    const vaultPath = args[vaultFlagIndex + 1];
    if (!vaultPath) {
      process.stderr.write('Usage: npm run learning:verify-test-vault -- --vault <vault-root>\n');
      process.exit(2);
    }
    return path.resolve(vaultPath, '.obsidian', 'plugins', 'claudian-ai-tutor');
  }

  const pluginFlagIndex = args.indexOf('--plugin-dir');
  if (pluginFlagIndex >= 0) {
    const pluginPath = args[pluginFlagIndex + 1];
    if (!pluginPath) {
      process.stderr.write('Usage: npm run learning:verify-test-vault -- --plugin-dir <plugin-dir>\n');
      process.exit(2);
    }
    return path.resolve(pluginPath);
  }

  return DEFAULT_PLUGIN_DIR;
}

function sha256(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/') || '.';
}
