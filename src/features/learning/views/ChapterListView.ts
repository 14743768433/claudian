import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import type { CourseState, LessonSession } from '../domain/types';
import { VIEW_TYPE_CHAPTER_LIST } from './viewTypes';

export class ChapterListView extends ItemView {
  private courseId: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAPTER_LIST;
  }

  getDisplayText(): string {
    return 'AI Tutor Chapters';
  }

  getIcon(): string {
    return 'list-tree';
  }

  setCourseId(courseId: string): void {
    this.courseId = courseId;
    void this.render();
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('ai-tutor-chapters');

    const course = await this.loadCourse();
    if (!course) {
      container.createDiv({ text: 'Open a course to see chapters.' });
      return;
    }

    container.createEl('h3', { text: course.goalTitle || 'Current course' });
    const courseHeader = container.createDiv({ cls: 'ai-tutor-course-heading is-active' });
    courseHeader.createDiv({ cls: 'ai-tutor-course-heading-title', text: course.title });

    const lessons = this.sortedLessons(course);
    for (const lesson of lessons) {
      this.renderLesson(container, course, lesson);
    }
  }

  private async loadCourse(): Promise<CourseState | null> {
    if (this.courseId) {
      return this.plugin.learningController.loadCourse(this.courseId);
    }
    return this.plugin.learningController.loadCurrentCourse();
  }

  private sortedLessons(course: CourseState): LessonSession[] {
    return [...course.lessons].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'intake' ? -1 : 1;
      return a.chapterNumber - b.chapterNumber;
    });
  }

  private renderLesson(parent: HTMLElement, course: CourseState, lesson: LessonSession): void {
    const item = parent.createDiv({
      cls: `ai-tutor-chapter-item${lesson.lessonId === course.currentLessonId ? ' is-active' : ''}`,
    });
    item.createDiv({
      cls: 'ai-tutor-chapter-title',
      text: lesson.kind === 'intake' ? 'Intake' : `${lesson.chapterNumber}. ${lesson.title}`,
    });
    item.createDiv({
      cls: 'ai-tutor-chapter-meta',
      text: `${lesson.status} · ${lesson.sections.length} sections`,
    });
    item.addEventListener('click', () => {
      void this.plugin.learningController.enterLesson(course.courseId, lesson.lessonId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(`Failed to open chapter: ${message}`);
        });
    });
  }
}
