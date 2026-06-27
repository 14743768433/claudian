#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const LEARNING_ROOT = path.join(ROOT, 'src', 'features', 'learning');
const filesToCount = [
  'src/features/learning/LearningController.ts',
  'src/features/chat/controllers/InputController.ts',
];

const report = {
  generatedAt: new Date().toISOString(),
  branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
  commit: runGit(['rev-parse', '--short', 'HEAD']),
  lineCounts: Object.fromEntries(filesToCount.map((file) => [file, countLines(file)])),
  saveCourseCalls: searchFiles(LEARNING_ROOT, /\bsaveCourse\s*\(/),
  obsidianImports: searchFiles(LEARNING_ROOT, /\bfrom\s+['"]obsidian['"]|\bimport\b[\s\S]*?['"]obsidian['"]/),
};

process.stdout.write(formatMarkdown(report));

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

function countLines(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf8');
  if (content.length === 0) return 0;
  return content.split(/\r\n|\r|\n/).length;
}

function searchFiles(root, pattern) {
  const hits = [];
  for (const filePath of walkTsFiles(root)) {
    const relativePath = toPosix(path.relative(ROOT, filePath));
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r\n|\r|\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push({
          file: relativePath,
          line: index + 1,
          text: line.trim(),
        });
      }
      pattern.lastIndex = 0;
    });
  }
  return hits;
}

function* walkTsFiles(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkTsFiles(fullPath);
    } else if (entry.isFile() && fullPath.endsWith('.ts')) {
      yield fullPath;
    }
  }
}

function formatMarkdown(value) {
  const lines = [
    '# Stage 03 Baseline Snapshot',
    '',
    `Generated: ${value.generatedAt}`,
    `Branch: ${value.branch}`,
    `Commit: ${value.commit}`,
    '',
    '## Line Counts',
    '',
    '| File | Lines |',
    '| --- | ---: |',
  ];

  for (const [file, lineCount] of Object.entries(value.lineCounts)) {
    lines.push(`| ${file} | ${lineCount ?? 'missing'} |`);
  }

  lines.push('', '## saveCourse Call Sites', '');
  appendHits(lines, value.saveCourseCalls);

  lines.push('', '## Obsidian Imports In Learning Feature', '');
  appendHits(lines, value.obsidianImports);

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function appendHits(lines, hits) {
  if (hits.length === 0) {
    lines.push('- none');
    return;
  }
  for (const hit of hits) {
    lines.push(`- ${hit.file}:${hit.line} - \`${hit.text.replace(/`/g, '\\`')}\``);
  }
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}
