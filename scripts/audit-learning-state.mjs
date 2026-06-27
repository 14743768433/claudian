#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const vaultRoot = path.resolve(process.cwd(), args.vault);
const dataPath = path.join(vaultRoot, '.obsidian', 'plugins', args.pluginId, 'data.json');
const report = auditLearningState({ vaultRoot, dataPath, pluginId: args.pluginId });

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printTextReport(report);
}

if (args.strict && report.issues.some((issue) => issue.severity === 'error')) {
  process.exitCode = 1;
}

function auditLearningState({ vaultRoot, dataPath, pluginId }) {
  const issues = [];
  const courses = [];
  const data = readJson(dataPath, issues, 'plugin-data');
  const indexEntries = Array.isArray(data?.learning?.courses) ? data.learning.courses : [];

  if (!data) {
    return {
      generatedAt: new Date().toISOString(),
      vaultRoot,
      pluginId,
      dataPath,
      indexEntries: 0,
      courses,
      issues,
    };
  }

  if (!Array.isArray(data?.learning?.courses)) {
    issues.push({
      severity: 'warning',
      code: 'missing-learning-index',
      path: dataPath,
      message: 'Plugin data has no learning.courses array.',
    });
  }

  const entriesByRoot = new Map();
  for (const entry of indexEntries) {
    if (!isCourseIndexEntry(entry)) {
      issues.push({
        severity: 'warning',
        code: 'invalid-index-entry',
        path: dataPath,
        message: 'Ignored a malformed course index entry.',
      });
      continue;
    }
    const root = normalizeVaultPath(entry.rootPath);
    const existing = entriesByRoot.get(root) ?? [];
    existing.push(entry);
    entriesByRoot.set(root, existing);
  }

  for (const [rootPath, entries] of entriesByRoot) {
    if (entries.length > 1) {
      issues.push({
        severity: 'error',
        code: 'duplicate-index-root',
        path: dataPath,
        courseIds: entries.map((entry) => entry.courseId),
        rootPath,
        message: `Multiple course index entries point at ${rootPath}.`,
      });
    }
  }

  for (const entry of indexEntries.filter(isCourseIndexEntry)) {
    const rootPath = normalizeVaultPath(entry.rootPath);
    const statePath = path.join(vaultRoot, ...rootPath.split('/'), '.ai-tutor', 'course-state.json');
    const state = readJson(statePath, issues, 'course-state');
    if (!state) continue;

    const course = {
      courseId: state.courseId,
      indexCourseId: entry.courseId,
      title: state.title,
      rootPath,
      statePath,
      machineState: state.machineState,
      currentLessonId: state.currentLessonId,
      lessonCount: Array.isArray(state.lessons) ? state.lessons.length : 0,
    };
    courses.push(course);

    if (state.courseId !== entry.courseId) {
      issues.push({
        severity: 'error',
        code: 'index-state-course-id-mismatch',
        path: statePath,
        indexCourseId: entry.courseId,
        stateCourseId: state.courseId,
        rootPath,
        message: 'The index entry courseId does not match course-state.json.',
      });
    }

    if (!Array.isArray(state.lessons)) {
      issues.push({
        severity: 'error',
        code: 'invalid-lessons',
        path: statePath,
        courseId: state.courseId,
        message: 'course-state.json has no lessons array.',
      });
      continue;
    }

    if (!state.lessons.some((lesson) => lesson?.lessonId === state.currentLessonId)) {
      issues.push({
        severity: 'error',
        code: 'missing-current-lesson',
        path: statePath,
        courseId: state.courseId,
        currentLessonId: state.currentLessonId,
        message: 'currentLessonId does not point at an existing lesson.',
      });
    }

    const activeLessons = state.lessons.filter((lesson) => lesson?.status === 'active');
    if (activeLessons.length > 1) {
      issues.push({
        severity: 'error',
        code: 'multiple-active-lessons',
        path: statePath,
        courseId: state.courseId,
        lessonIds: activeLessons.map((lesson) => lesson.lessonId),
        message: 'More than one lesson is active in the same course.',
      });
    }

    for (const lesson of state.lessons) {
      auditLesson({ statePath, courseId: state.courseId, lesson, issues });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    pluginId,
    dataPath,
    indexEntries: indexEntries.length,
    courses,
    issues,
    totals: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
  };
}

function auditLesson({ statePath, courseId, lesson, issues }) {
  if (!lesson || typeof lesson !== 'object') {
    issues.push({
      severity: 'error',
      code: 'invalid-lesson',
      path: statePath,
      courseId,
      message: 'A lesson entry is malformed.',
    });
    return;
  }

  const sectionCount = Array.isArray(lesson.sections) ? lesson.sections.length : 0;
  if (lesson.kind === 'lesson' && lesson.status !== 'planned' && sectionCount === 0) {
    issues.push({
      severity: 'warning',
      code: 'empty-started-lesson',
      path: statePath,
      courseId,
      lessonId: lesson.lessonId,
      status: lesson.status,
      message: 'A started lesson has no planned sections.',
    });
  }

  if (typeof lesson.coveredSummary === 'string' && /```ai-tutor-action|```ai-tutor-next-options/.test(lesson.coveredSummary)) {
    issues.push({
      severity: 'warning',
      code: 'summary-protocol-leak',
      path: statePath,
      courseId,
      lessonId: lesson.lessonId,
      message: 'coveredSummary contains AI Tutor protocol fences.',
    });
  }
}

function readJson(filePath, issues, kind) {
  if (!fs.existsSync(filePath)) {
    issues.push({
      severity: kind === 'plugin-data' ? 'error' : 'warning',
      code: `missing-${kind}`,
      path: filePath,
      message: `Missing ${kind} JSON file.`,
    });
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    issues.push({
      severity: 'error',
      code: `invalid-${kind}-json`,
      path: filePath,
      message: error instanceof Error ? error.message : `Invalid ${kind} JSON.`,
    });
    return null;
  }
}

function isCourseIndexEntry(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.courseId === 'string'
    && typeof value.title === 'string'
    && typeof value.goalTitle === 'string'
    && typeof value.rootPath === 'string'
    && typeof value.currentLessonId === 'string'
    && typeof value.updatedAt === 'number';
}

function normalizeVaultPath(value) {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function parseArgs(argv) {
  const parsed = {
    vault: 'ai-tutor-test-vault',
    pluginId: 'claudian-ai-tutor',
    json: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--vault') {
      parsed.vault = argv[++index] ?? parsed.vault;
    } else if (arg === '--plugin-id') {
      parsed.pluginId = argv[++index] ?? parsed.pluginId;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printTextReport(report) {
  process.stdout.write(`AI Tutor learning-state audit\n`);
  process.stdout.write(`Vault: ${report.vaultRoot}\n`);
  process.stdout.write(`Index entries: ${report.indexEntries}\n`);
  process.stdout.write(`Courses inspected: ${report.courses.length}\n`);
  process.stdout.write(`Issues: ${report.totals?.errors ?? 0} error(s), ${report.totals?.warnings ?? 0} warning(s)\n\n`);

  for (const issue of report.issues) {
    const location = issue.lessonId ? `${issue.path} (${issue.lessonId})` : issue.path;
    process.stdout.write(`[${issue.severity}] ${issue.code}: ${issue.message}\n`);
    process.stdout.write(`  ${location}\n`);
  }
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/audit-learning-state.mjs [options]',
    '',
    'Options:',
    '  --vault <path>       Obsidian vault root. Default: ai-tutor-test-vault',
    '  --plugin-id <id>     Plugin folder name. Default: claudian-ai-tutor',
    '  --json               Print the full JSON report.',
    '  --strict             Exit non-zero when error-level issues are found.',
  ].join('\n'));
}
