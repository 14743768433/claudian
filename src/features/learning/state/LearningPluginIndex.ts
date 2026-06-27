import type { CourseIndexEntry, CourseState, LearningPluginData } from './types';
import { normalizeLearningPath } from './path';

type PluginDataAccess = {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCourseIndexEntry(value: unknown): value is CourseIndexEntry {
  if (!isRecord(value)) return false;
  return typeof value.courseId === 'string'
    && typeof value.title === 'string'
    && typeof value.goalTitle === 'string'
    && typeof value.rootPath === 'string'
    && typeof value.currentLessonId === 'string'
    && typeof value.updatedAt === 'number';
}

function toCourseIndexEntry(state: CourseState): CourseIndexEntry {
  return {
    courseId: state.courseId,
    title: state.title,
    goalTitle: state.goalTitle,
    rootPath: state.rootPath,
    currentLessonId: state.currentLessonId,
    updatedAt: state.updatedAt,
  };
}

export class LearningPluginIndex {
  constructor(private readonly plugin: PluginDataAccess) {}

  async listCourses(): Promise<CourseIndexEntry[]> {
    const data = await this.loadPluginData();
    const courses = data.learning?.courses ?? [];
    return [...courses].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async upsertCourse(entry: CourseIndexEntry): Promise<void> {
    const data = await this.loadPluginData();
    const courses = data.learning?.courses ?? [];
    const normalizedEntry: CourseIndexEntry = {
      ...entry,
      rootPath: normalizeLearningPath(entry.rootPath),
    };
    const next = [
      normalizedEntry,
      ...courses.filter((course) => course.courseId !== normalizedEntry.courseId
        && normalizeLearningPath(course.rootPath) !== normalizedEntry.rootPath),
    ].sort((a, b) => b.updatedAt - a.updatedAt);

    await this.savePluginData({
      ...data,
      learning: {
        ...(data.learning ?? {}),
        courses: next,
      },
    });
  }

  async removeCourse(courseId: string): Promise<void> {
    const data = await this.loadPluginData();
    const courses = data.learning?.courses ?? [];
    await this.savePluginData({
      ...data,
      learning: {
        ...(data.learning ?? {}),
        courses: courses.filter((course) => course.courseId !== courseId),
      },
    });
  }

  async refreshFromCourseState(courseState: CourseState): Promise<void> {
    await this.upsertCourse(toCourseIndexEntry(courseState));
  }

  private async loadPluginData(): Promise<LearningPluginData & Record<string, unknown>> {
    const raw = await this.plugin.loadData();
    const data = isRecord(raw) ? raw : {};
    const learning = isRecord(data.learning) ? data.learning : {};
    const rawCourses = Array.isArray(learning.courses) ? learning.courses : [];
    const courses = rawCourses.filter(isCourseIndexEntry);
    return {
      ...data,
      learning: {
        ...learning,
        courses,
      },
    };
  }

  private async savePluginData(data: LearningPluginData & Record<string, unknown>): Promise<void> {
    await this.plugin.saveData(data);
  }
}
