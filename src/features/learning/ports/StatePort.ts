import type { CourseIndexEntry, CourseState, LoadedLessonRef } from '../domain/types';

export interface StatePort {
  loadCourse(courseId: string, rootPath?: string): Promise<CourseState | null>;
  saveCourse(state: CourseState, options?: { preserveUpdatedAt?: boolean }): Promise<void>;
  listCourses(): Promise<CourseState[]>;
  loadCurrentCourse(): Promise<CourseState | null>;
  findByConversationId(conversationId: string): Promise<LoadedLessonRef | null>;
  listIndex(): Promise<CourseIndexEntry[]>;
  upsertIndex(entry: CourseIndexEntry): Promise<void>;
  removeIndex(courseId: string): Promise<void>;
}
