#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = parseArgs(process.argv.slice(2));
const vaultRoot = path.resolve(ROOT, args.vault);
const pluginManifest = path.join(vaultRoot, '.obsidian', 'plugins', 'claudian-ai-tutor', 'manifest.json');
const uri = `obsidian://open?path=${encodeURIComponent(vaultRoot)}`;

if (args.print) {
  printOpenInfo();
  process.exit(0);
}

if (!fs.existsSync(pluginManifest)) {
  process.stderr.write(`Smoke vault is not prepared yet: ${relative(vaultRoot)}\n`);
  process.stderr.write('Run npm run learning:smoke-ready -- --fresh first.\n');
  process.exit(1);
}

openUri(uri);
printOpenInfo();

function openUri(value) {
  let command;
  let commandArgs;
  if (process.platform === 'win32') {
    command = process.env.ComSpec || 'cmd.exe';
    commandArgs = ['/d', '/s', '/c', `start "" ${quoteCmdArg(value)}`];
  } else if (process.platform === 'darwin') {
    command = 'open';
    commandArgs = [value];
  } else {
    command = 'xdg-open';
    commandArgs = [value];
  }

  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(`Could not open Obsidian automatically. URI: ${value}\n`);
    if (result.error) {
      process.stderr.write(`${result.error.message}\n`);
    }
    process.exit(result.status ?? 1);
  }
}

function printOpenInfo() {
  process.stdout.write([
    `Smoke vault: ${vaultRoot}`,
    `Obsidian URI: ${uri}`,
    'Post-smoke verifier: npm run learning:verify-manual-smoke -- --vault ai-tutor-smoke-vault',
  ].join('\n'));
  process.stdout.write('\n');
}

function parseArgs(argv) {
  const parsed = {
    vault: 'ai-tutor-smoke-vault',
    print: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--vault') {
      parsed.vault = argv[++index] ?? parsed.vault;
    } else if (arg === '--print') {
      parsed.print = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/open-smoke-vault.mjs [options]',
    '',
    'Options:',
    '  --vault <path>       Obsidian vault root. Default: ai-tutor-smoke-vault',
    '  --print              Print the Obsidian URI without opening it.',
  ].join('\n'));
}

function quoteCmdArg(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/') || '.';
}
