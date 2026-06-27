import { normalizeLearningPath } from '../domain/path';
import { LearningPluginIndex } from './LearningPluginIndex';
import {
  COURSE_STATE_FILE,
  CourseMachineState,
  CourseIndexEntry,
  CourseState,
  LEARNING_SCHEMA_VERSION,
  LessonSession,
  LessonStatus,
  LoadedLessonRef,
  SectionStatus,
} from '../domain/types';

interface LearningStateFileAccess {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const COURSE_MACHINE_STATES: ReadonlySet<CourseMachineState> = new Set([
  'intake',
  'chapterPlanning',
  'teaching',
  'chapterEnded',
  'completed',
]);
const LESSON_STATUSES: ReadonlySet<LessonStatus> = new Set(['planned', 'active', 'ended']);
const SECTION_STATUSES: ReadonlySet<SectionStatus> = new Set(['pending', 'noteWritten', 'covered']);

function statePath(rootPath: string): string {
  return `${normalizeLearningPath(rootPath)}/${COURSE_STATE_FILE}`;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isSyllabusTopic(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.order === 'number'
    && (value.sourcePaths === undefined || (
      Array.isArray(value.sourcePaths)
      && value.sourcePaths.every((path) => typeof path === 'string')
    ))
    && isOptionalString(value.summary);
}

function isSection(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && SECTION_STATUSES.has(value.status as SectionStatus)
    && isOptionalString(value.notePath)
    && isOptionalString(value.noteTitle)
    && (value.missing === undefined || typeof value.missing === 'boolean');
}

function isLesson(value: unknown): value is LessonSession {
  return isRecord(value)
    && typeof value.lessonId === 'string'
    && (value.kind === 'intake' || value.kind === 'lesson')
    && typeof value.chapterNumber === 'number'
    && typeof value.title === 'string'
    && typeof value.conversationId === 'string'
    && LESSON_STATUSES.has(value.status as LessonStatus)
    && Array.isArray(value.sections)
    && value.sections.every(isSection)
    && typeof value.currentSectionIndex === 'number'
    && isOptionalString(value.coveredSummary)
    && isOptionalString(value.previousLessonId)
    && typeof value.createdAt === 'number'
    && typeof value.updatedAt === 'number';
}

function validateCourseState(value: unknown): CourseState | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== LEARNING_SCHEMA_VERSION) return null;
  if (
    typeof value.courseId !== 'string'
    || typeof value.title !== 'string'
    || typeof value.goalTitle !== 'string'
    || typeof value.rootPath !== 'string'
    || typeof value.currentLessonId !== 'string'
    || !COURSE_MACHINE_STATES.has(value.machineState as CourseMachineState)
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
    || !Array.isArray(value.syllabus)
    || !Array.isArray(value.lessons)
    || !value.syllabus.every(isSyllabusTopic)
    || !value.lessons.every(isLesson)
  ) {
    return null;
  }

  if (!value.lessons.some((lesson) => lesson.lessonId === value.currentLessonId)) {
    return null;
  }

  return value as unknown as CourseState;
}

export class LearningStateService {
  constructor(
    private readonly adapter: LearningStateFileAccess,
    private readonly index: LearningPluginIndex,
  ) {}

  getCourseStatePath(rootPath: string): string {
    return statePath(rootPath);
  }

  async listCourses(): Promise<CourseState[]> {
    const entries = await this.index.listCourses();
    const states: CourseState[] = [];
    for (const entry of entries) {
      const state = await this.loadCourse(entry.courseId, entry.rootPath);
      if (state) {
        states.push(state);
      }
    }
    return states;
  }

  async loadCurrentCourse(): Promise<CourseState | null> {
    const entries = await this.index.listCourses();
    for (const entry of entries) {
      const state = await this.loadCourse(entry.courseId, entry.rootPath);
      if (state) {
        return state;
      }
    }
    return null;
  }

  async loadCourse(courseId: string, rootPath?: string): Promise<CourseState | null> {
    const resolvedRoot = rootPath ?? await this.findRootPath(courseId);
    if (!resolvedRoot) return null;

    const path = statePath(resolvedRoot);
    if (!(await this.adapter.exists(path))) return null;

    try {
      const parsed = JSON.parse(await this.adapter.read(path));
      const state = validateCourseState(parsed);
      if (!state || state.courseId !== courseId) return null;
      return state;
    } catch {
      return null;
    }
  }

  async saveCourse(state: CourseState, options?: { preserveUpdatedAt?: boolean }): Promise<void> {
    const next: CourseState = {
      ...state,
      rootPath: normalizeLearningPath(state.rootPath),
      updatedAt: options?.preserveUpdatedAt ? state.updatedAt : Date.now(),
    };
    await this.adapter.write(
      statePath(next.rootPath),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    Object.assign(state, next);
  }

  currentLesson(state: CourseState): LessonSession | null {
    return state.lessons.find((lesson) => lesson.lessonId === state.currentLessonId) ?? null;
  }

  async findByConversationId(conversationId: string): Promise<LoadedLessonRef | null> {
    const entries = await this.index.listCourses();
    for (const entry of entries) {
      const course = await this.loadCourse(entry.courseId, entry.rootPath);
      const lesson = course?.lessons.find((candidate) => candidate.conversationId === conversationId);
      if (course && lesson) {
        return { course, lesson };
      }
    }
    return null;
  }

  private async findRootPath(courseId: string): Promise<string | null> {
    const entry = (await this.index.listCourses())
      .find((candidate: CourseIndexEntry) => candidate.courseId === courseId);
    return entry?.rootPath ?? null;
  }
}
