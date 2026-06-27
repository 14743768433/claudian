#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = parseArgs(process.argv.slice(2));
const vaultRoot = path.resolve(ROOT, args.fresh ? args.freshVault : args.vault);
const pluginDir = path.join(vaultRoot, '.obsidian', 'plugins', 'claudian-ai-tutor');
const dataPath = path.join(pluginDir, 'data.json');

prepareVaultForSmoke();
runNpm(['run', 'verify']);
runNpm(['run', 'learning:deploy-test-vault', '--', '--vault', vaultRoot]);
runNpm(['run', 'learning:verify-test-vault', '--', '--vault', vaultRoot]);

printCourseList();
printNextSteps();

function runNpm(commandArgs) {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', ['npm', ...commandArgs].map(quoteCmdArg).join(' ')]
    : commandArgs;
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`Failed to run npm ${commandArgs.join(' ')}: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printCourseList() {
  process.stdout.write('\nAI Tutor smoke readiness:\n');
  process.stdout.write(`- Vault: ${relative(vaultRoot)}\n`);
  process.stdout.write(`- Plugin dir: ${relative(pluginDir)}\n`);

  if (!fs.existsSync(dataPath)) {
    process.stdout.write('- Existing courses: none yet; create a new course during the smoke.\n');
    return;
  }

  const data = readJson(dataPath);
  const courses = Array.isArray(data?.learning?.courses)
    ? data.learning.courses.filter(isCourseIndexEntry)
    : [];
  if (courses.length === 0) {
    process.stdout.write('- Existing courses: none yet; create a new course during the smoke.\n');
    return;
  }

  process.stdout.write('- Existing courses:\n');
  for (const course of [...courses].sort((a, b) => b.updatedAt - a.updatedAt)) {
    process.stdout.write(`  - ${course.title} (${course.courseId}) current=${course.currentLessonId}\n`);
  }
}

function printNextSteps() {
  process.stdout.write([
    '',
    'Ready for manual Obsidian smoke.',
    args.fresh
      ? '1. Open the smoke vault with npm run learning:open-smoke-vault.'
      : `1. Open or reload this vault in Obsidian: ${vaultRoot}`,
    '2. Run the checklist in specs/03-learning-architecture-hardening/manual-smoke-checklist.md.',
    args.fresh
      ? '3. After the smoke, run npm run learning:verify-manual-smoke -- --vault ai-tutor-smoke-vault.'
      : '3. After the smoke, run npm run learning:verify-manual-smoke.',
    args.fresh
      ? '4. If you used --fresh-vault <path>, pass the same path to --vault.'
      : '4. If you tested a non-newest course, run npm run learning:verify-manual-smoke -- --course-id <courseId>.',
    '',
  ].join('\n'));
}

function prepareVaultForSmoke() {
  fs.mkdirSync(vaultRoot, { recursive: true });
  const obsidianDir = path.join(vaultRoot, '.obsidian');
  const pluginsDir = path.join(obsidianDir, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });

  const communityPluginsPath = path.join(obsidianDir, 'community-plugins.json');
  const communityPlugins = readJsonArray(communityPluginsPath);
  if (!communityPlugins.includes('claudian-ai-tutor')) {
    communityPlugins.push('claudian-ai-tutor');
    fs.writeFileSync(communityPluginsPath, `${JSON.stringify(communityPlugins, null, 2)}\n`);
  }

  const appConfigPath = path.join(obsidianDir, 'app.json');
  const appConfig = readJsonObject(appConfigPath);
  if (appConfig.safeMode !== false) {
    appConfig.safeMode = false;
    fs.writeFileSync(appConfigPath, `${JSON.stringify(appConfig, null, 2)}\n`);
  }

  if (args.fresh && fs.existsSync(dataPath)) {
    process.stdout.write(`Fresh smoke vault already has plugin data at ${relative(dataPath)}; create a new course or pass --vault <path> for another clean folder.\n`);
  }
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    process.stdout.write(`- Existing courses: could not read ${relative(filePath)} (${error instanceof Error ? error.message : String(error)}).\n`);
    return null;
  }
}

function isCourseIndexEntry(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.courseId === 'string'
    && typeof value.title === 'string'
    && typeof value.currentLessonId === 'string'
    && typeof value.updatedAt === 'number';
}

function parseArgs(argv) {
  const parsed = {
    vault: 'ai-tutor-test-vault',
    fresh: false,
    freshVault: 'ai-tutor-smoke-vault',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--vault') {
      parsed.vault = argv[++index] ?? parsed.vault;
    } else if (arg === '--fresh') {
      parsed.fresh = true;
    } else if (arg === '--fresh-vault') {
      parsed.fresh = true;
      parsed.freshVault = argv[++index] ?? parsed.freshVault;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/learning-smoke-readiness.mjs [options]',
    '',
    'Options:',
    '  --vault <path>       Obsidian vault root. Default: ai-tutor-test-vault',
    '  --fresh              Use a clean smoke vault. Default: ai-tutor-smoke-vault',
    '  --fresh-vault <path> Use a custom clean smoke vault path and enable --fresh.',
  ].join('\n'));
}

function quoteCmdArg(value) {
  if (/^[^\s"&|<>^]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/') || '.';
}
