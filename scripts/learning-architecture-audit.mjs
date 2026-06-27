#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LEARNING_ROOT = path.join(ROOT, 'src', 'features', 'learning');
const EXPECTED_TOP_LEVEL_DIRS = ['adapters', 'application', 'domain', 'ports', 'views'];
const LEGACY_TOP_LEVEL_DIRS = new Set(['content', 'context', 'flow', 'prompt', 'state']);

const failures = [];

auditTopLevelDirectories();
auditLegacyEntrypointImports();
auditLearningObsidianImports();
auditSaveCourseCalls();

if (failures.length > 0) {
  process.stderr.write('Learning architecture audit failed:\n');
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write('Learning architecture audit passed.\n');

function auditTopLevelDirectories() {
  const dirs = fs.readdirSync(LEARNING_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const expected = [...EXPECTED_TOP_LEVEL_DIRS].sort();
  if (dirs.join('\0') !== expected.join('\0')) {
    failures.push(`Expected learning top-level directories ${expected.join(', ')} but found ${dirs.join(', ')}.`);
  }
}

function auditLegacyEntrypointImports() {
  for (const filePath of walkFiles(path.join(ROOT, 'src'), '.ts')) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const specifier of importSpecifiers(text)) {
      if (specifier.match(/^@\/features\/learning\/(content|context|flow|prompt|state)(\/|$)/)) {
        failures.push(`${relative(filePath)} imports legacy learning entrypoint ${specifier}.`);
      }

      if (filePath.startsWith(`${LEARNING_ROOT}${path.sep}`) && specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filePath), specifier);
        const relativeToLearning = path.relative(LEARNING_ROOT, resolved).split(path.sep);
        if (LEGACY_TOP_LEVEL_DIRS.has(relativeToLearning[0])) {
          failures.push(`${relative(filePath)} imports legacy learning entrypoint ${specifier}.`);
        }
      }
    }
  }

  const testsRoot = path.join(ROOT, 'tests');
  if (!fs.existsSync(testsRoot)) return;
  for (const filePath of walkFiles(testsRoot, '.ts')) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const specifier of importSpecifiers(text)) {
      if (specifier.match(/^@\/features\/learning\/(content|context|flow|prompt|state)(\/|$)/)) {
        failures.push(`${relative(filePath)} imports legacy learning entrypoint ${specifier}.`);
      }
    }
  }
}

function auditLearningObsidianImports() {
  for (const filePath of walkFiles(LEARNING_ROOT, '.ts')) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const specifier of importSpecifiers(text)) {
      if (specifier !== 'obsidian') continue;
      const rel = toPosix(path.relative(LEARNING_ROOT, filePath));
      const allowed = rel.startsWith('adapters/')
        || rel.startsWith('views/')
        || rel === 'LearningController.ts';
      if (!allowed) {
        failures.push(`${relative(filePath)} imports obsidian outside adapters/views/composition root.`);
      }
    }
  }
}

function auditSaveCourseCalls() {
  const allowed = 'src/features/learning/application/StateTransitionService.ts';
  for (const filePath of walkFiles(LEARNING_ROOT, '.ts')) {
    const rel = toPosix(path.relative(ROOT, filePath));
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r\n|\r|\n/);
    lines.forEach((line, index) => {
      if (!/\.\s*saveCourse\s*\(/.test(line)) return;
      if (rel !== allowed) {
        failures.push(`${rel}:${index + 1} calls .saveCourse() outside StateTransitionService.`);
      }
    });
  }
}

function* walkFiles(root, extension) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      yield* walkFiles(fullPath, extension);
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      yield fullPath;
    }
  }
}

function importSpecifiers(text) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function relative(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}
