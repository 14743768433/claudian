import { ItemView, Modal, Notice, Setting, type WorkspaceLeaf } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import type { CourseIndexEntry } from '../domain/types';
import { VIEW_TYPE_COURSE_LIBRARY } from './viewTypes';

class NewCourseModal extends Modal {
  private title = '';
  private goal = '';

  constructor(
    app: ClaudianPlugin['app'],
    private readonly onSubmit: (input: { title: string; goalTitle: string }) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'New AI Tutor Course' });

    new Setting(this.contentEl)
      .setName('Course name')
      .addText((text) => {
        text
          .setPlaceholder('Signals and Systems')
          .onChange((value) => { this.title = value; });
      });

    new Setting(this.contentEl)
      .setName('Learning goal')
      .setDesc('Describe what this course should help you learn.')
      .addTextArea((text) => {
        text
          .setPlaceholder('I want to understand...')
          .onChange((value) => { this.goal = value; });
        text.inputEl.rows = 4;
      });

    const actions = this.contentEl.createDiv({ cls: 'ai-tutor-modal-actions' });
    const createButton = actions.createEl('button', { text: 'Create' });
    createButton.addClass('mod-cta');
    createButton.addEventListener('click', () => {
      void this.submit();
    });
  }

  private async submit(): Promise<void> {
    const title = this.title.trim();
    const goalTitle = this.goal.trim();
    if (!title && !goalTitle) {
      new Notice('Add a course name or learning goal first.');
      return;
    }
    await this.onSubmit({
      title: title || goalTitle,
      goalTitle: goalTitle || title,
    });
    this.close();
  }
}

export class CourseLibraryView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_COURSE_LIBRARY;
  }

  getDisplayText(): string {
    return 'AI Tutor Courses';
  }

  getIcon(): string {
    return 'library';
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('ai-tutor-library');

    const header = container.createDiv({ cls: 'ai-tutor-library-header' });
    header.createEl('h2', { text: 'AI Tutor' });
    const createButton = header.createEl('button', {
      cls: 'clickable-icon ai-tutor-create-course',
      attr: { 'aria-label': 'Create course', title: 'Create course' },
    });
    createButton.setText('+');
    createButton.addEventListener('click', () => {
      new NewCourseModal(this.app, async (input) => {
        await this.plugin.learningController.createCourse(input);
        await this.render();
      }).open();
    });

    const courses = await this.plugin.learningController.listCourseEntries();
    if (courses.length === 0) {
      container.createDiv({
        cls: 'ai-tutor-empty',
        text: 'Create a course to begin.',
      });
      return;
    }

    const list = container.createDiv({ cls: 'ai-tutor-course-grid' });
    for (const course of courses) {
      this.renderCourseCard(list, course);
    }
  }

  private renderCourseCard(parent: HTMLElement, course: CourseIndexEntry): void {
    const card = parent.createDiv({ cls: 'ai-tutor-course-card' });
    card.createDiv({ cls: 'ai-tutor-course-title', text: course.title });
    card.createDiv({ cls: 'ai-tutor-course-goal', text: course.goalTitle });
    card.addEventListener('click', () => {
      void this.plugin.learningController.enterCourse(course.courseId);
    });
  }
}

