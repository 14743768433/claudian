#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const vaultRoot = path.resolve(process.cwd(), args.vault);
const pluginId = args.pluginId;
const dataPath = path.join(vaultRoot, '.obsidian', 'plugins', pluginId, 'data.json');
const failures = [];
const notes = [];

const data = readJson(dataPath, 'plugin data');
const entries = Array.isArray(data?.learning?.courses) ? data.learning.courses.filter(isCourseIndexEntry) : [];

if (entries.length === 0) {
  failures.push('No AI Tutor course index entries found in plugin data.');
}

if (args.list) {
  if (failures.length > 0) {
    printFailures(null, entries);
    process.exit(1);
  }
  printCourseList(entries);
  process.exit(0);
}

const entry = selectCourse(entries, args.courseId);
let state = null;
let statePath = null;

if (entry) {
  statePath = path.join(vaultRoot, ...normalizeVaultPath(entry.rootPath).split('/'), '.ai-tutor', 'course-state.json');
  state = readJson(statePath, 'course state');
}

if (state && entry) {
  verifyCourse(entry, state, statePath);
}

if (failures.length > 0) {
  printFailures(entry, entries);
  process.exit(1);
}

process.stdout.write('AI Tutor manual smoke state verification passed.\n');
if (entry) {
  process.stdout.write(`Course: ${entry.title} (${entry.courseId})\n`);
}
for (const note of notes) {
  process.stdout.write(`- ${note}\n`);
}

function verifyCourse(entry, course, courseStatePath) {
  if (course.courseId !== entry.courseId) {
    failures.push(`Index courseId ${entry.courseId} does not match course-state courseId ${course.courseId}.`);
  }
  if (entry.currentLessonId !== course.currentLessonId) {
    failures.push(`Index currentLessonId ${entry.currentLessonId} does not match course-state currentLessonId ${course.currentLessonId}.`);
  }
  if (!Array.isArray(course.lessons)) {
    failures.push(`Course state has no lessons array: ${relative(courseStatePath)}.`);
    return;
  }

  const intake = course.lessons.find((lesson) => lesson.kind === 'intake');
  if (!intake) {
    failures.push('Course has no intake lesson.');
  } else if (intake.status !== 'ended') {
    failures.push(`Intake lesson should be ended after the smoke path, got ${intake.status}.`);
  }

  const current = course.lessons.find((lesson) => lesson.lessonId === course.currentLessonId);
  if (!current) {
    failures.push(`Current lesson ${course.currentLessonId} does not exist.`);
  } else {
    if (current.kind !== 'lesson') {
      failures.push(`Current lesson should be a chapter lesson after Start new lesson, got ${current.kind}.`);
    }
    if (current.status !== 'active') {
      failures.push(`Current lesson should be active after restart restore, got ${current.status}.`);
    }
    if (!current.conversationId) {
      failures.push('Current lesson has no conversationId.');
    }
    if (!['chapterPlanning', 'teaching'].includes(course.machineState)) {
      failures.push(`Course machineState should be chapterPlanning or teaching after Start new lesson, got ${course.machineState}.`);
    }
  }

  const endedChapter = course.lessons
    .filter((lesson) => lesson.kind === 'lesson' && lesson.status === 'ended')
    .find((lesson) => Array.isArray(lesson.sections)
      && lesson.sections.some((section) => section.status === 'covered' && section.notePath));

  if (!endedChapter) {
    failures.push('No ended chapter with a covered section note was found.');
  } else {
    const sectionWithNote = endedChapter.sections.find((section) => section.status === 'covered' && section.notePath);
    const notePath = normalizeVaultPath(sectionWithNote.notePath);
    const fullNotePath = path.join(vaultRoot, ...notePath.split('/'));
    if (!fs.existsSync(fullNotePath)) {
      failures.push(`Covered section note file is missing: ${notePath}.`);
    }
    if (current && current.chapterNumber <= endedChapter.chapterNumber) {
      failures.push(`Current chapter ${current.chapterNumber} is not after ended chapter ${endedChapter.chapterNumber}.`);
    }
    notes.push(`Ended chapter verified: ${endedChapter.title}; covered note: ${notePath}.`);
  }

  const activeLessons = course.lessons.filter((lesson) => lesson.status === 'active');
  if (activeLessons.length !== 1) {
    failures.push(`Expected exactly one active lesson, found ${activeLessons.length}.`);
  }

  if (current?.conversationId) {
    const sessionPath = path.join(vaultRoot, '.claudian', 'sessions', `${current.conversationId}.meta.json`);
    if (!fs.existsSync(sessionPath)) {
      failures.push(`Current lesson conversation metadata is missing: ${relative(sessionPath)}.`);
    } else {
      notes.push(`Current lesson conversation metadata exists: ${relative(sessionPath)}.`);
    }
  }
}

function selectCourse(entries, courseId) {
  if (entries.length === 0) return null;
  if (courseId) {
    const found = entries.find((candidate) => candidate.courseId === courseId);
    if (!found) {
      failures.push(`Course ${courseId} was not found in plugin data.`);
      return null;
    }
    return found;
  }

  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function printFailures(entry, entries) {
  process.stderr.write('AI Tutor manual smoke state verification failed:\n');
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  if (entry) {
    process.stderr.write(`\nSelected course: ${formatCourse(entry)}\n`);
  }
  if (notes.length > 0) {
    process.stderr.write('\nNotes:\n');
    for (const note of notes) {
      process.stderr.write(`- ${note}\n`);
    }
  }
  if (entries.length > 0) {
    process.stderr.write('\nAvailable courses:\n');
    for (const candidate of sortedCourses(entries)) {
      process.stderr.write(`- ${formatCourse(candidate)}\n`);
    }
    if (!args.courseId) {
      process.stderr.write('\nDefaulted to the newest course. If you smoke-tested a different course, rerun with --course-id <courseId>.\n');
    }
  }
}

function printCourseList(entries) {
  if (entries.length === 0) {
    process.stdout.write('No AI Tutor course index entries found.\n');
    return;
  }
  process.stdout.write('AI Tutor indexed courses:\n');
  for (const entry of sortedCourses(entries)) {
    process.stdout.write(`- ${formatCourse(entry)}\n`);
  }
}

function sortedCourses(entries) {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatCourse(entry) {
  return `${entry.title} (${entry.courseId}) current=${entry.currentLessonId} updated=${formatUpdatedAt(entry.updatedAt)} root=${entry.rootPath}`;
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString();
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    failures.push(`Missing ${label}: ${relative(filePath)}.`);
    return null;
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch (error) {
    failures.push(`Invalid ${label} JSON at ${relative(filePath)}: ${error instanceof Error ? error.message : String(error)}.`);
    return null;
  }
}

function isCourseIndexEntry(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.courseId === 'string'
    && typeof value.title === 'string'
    && typeof value.rootPath === 'string'
    && typeof value.currentLessonId === 'string'
    && typeof value.updatedAt === 'number';
}

function normalizeVaultPath(value) {
  return String(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function parseArgs(argv) {
  const parsed = {
    vault: 'ai-tutor-test-vault',
    pluginId: 'claudian-ai-tutor',
    courseId: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--vault') {
      parsed.vault = argv[++index] ?? parsed.vault;
    } else if (arg === '--plugin-id') {
      parsed.pluginId = argv[++index] ?? parsed.pluginId;
    } else if (arg === '--course-id') {
      parsed.courseId = argv[++index] ?? parsed.courseId;
    } else if (arg === '--list') {
      parsed.list = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/verify-manual-smoke-state.mjs [options]',
    '',
    'Options:',
    '  --vault <path>       Obsidian vault root. Default: ai-tutor-test-vault',
    '  --plugin-id <id>     Plugin folder name. Default: claudian-ai-tutor',
    '  --course-id <id>     Verify a specific course. Defaults to the newest course index entry.',
    '  --list              List indexed courses and exit.',
  ].join('\n'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/') || '.';
}
