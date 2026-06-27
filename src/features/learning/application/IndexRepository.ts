import type { CourseIndexEntry, CourseState } from '../domain/types';
import { normalizeLearningPath } from '../state/path';
import type { StatePort } from '../ports/StatePort';

type IndexStatePort = Pick<StatePort, 'listIndex' | 'upsertIndex' | 'removeIndex'>;

function toCourseIndexEntry(state: CourseState): CourseIndexEntry {
  return {
    courseId: state.courseId,
    title: state.title,
    goalTitle: state.goalTitle,
    rootPath: normalizeLearningPath(state.rootPath),
    currentLessonId: state.currentLessonId,
    updatedAt: state.updatedAt,
  };
}

export class IndexRepository {
  constructor(private readonly statePort: IndexStatePort) {}

  async listCourses(): Promise<CourseIndexEntry[]> {
    return this.statePort.listIndex();
  }

  async upsertCourse(entry: CourseIndexEntry): Promise<void> {
    await this.statePort.upsertIndex({
      ...entry,
      rootPath: normalizeLearningPath(entry.rootPath),
    });
  }

  async removeCourse(courseId: string): Promise<void> {
    await this.statePort.removeIndex(courseId);
  }

  async refreshFromCourseState(courseState: CourseState): Promise<void> {
    await this.upsertCourse(toCourseIndexEntry(courseState));
  }
}
