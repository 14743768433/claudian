import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import type { LearningLessonPlanContentBlock, LearningLessonPlanSource, MessageUiBlock } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import type { CourseState, LessonSession } from '../domain/types';
import { VIEW_TYPE_COURSE_ARTIFACTS } from './viewTypes';

function isLessonPlanBlock(block: unknown): block is LearningLessonPlanContentBlock {
  if (!block || typeof block !== 'object') return false;
  const candidate = block as Partial<LearningLessonPlanContentBlock>;
  return candidate.type === 'learning_lesson_plan'
    && typeof candidate.title === 'string'
    && Array.isArray(candidate.parts);
}

function sourceLabel(source: string | LearningLessonPlanSource): string {
  return typeof source === 'string' ? source.trim() : source.label.trim();
}

function sourcePath(source: string | LearningLessonPlanSource): string | null {
  if (typeof source !== 'string' && source.path?.trim()) {
    return source.path.trim();
  }
  const label = sourceLabel(source);
  if (!label) return null;
  const wiki = label.match(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]/);
  if (wiki?.[1]?.trim()) return wiki[1].trim();
  const markdown = label.match(/\]\(([^)]+?\.md)(?:#[^)]+)?\)/i);
  if (markdown?.[1]?.trim()) return markdown[1].trim();
  return /\.md(?:$|[\s"')\]])/i.test(label) ? label : null;
}

export class CourseArtifactsView extends ItemView {
  private courseId: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ClaudianPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_COURSE_ARTIFACTS;
  }

  getDisplayText(): string {
    return 'AI Tutor Notes';
  }

  getIcon(): string {
    return 'notebook-tabs';
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
    container.addClass('ai-tutor-artifacts');

    const course = this.courseId
      ? await this.plugin.learningController.loadCourse(this.courseId)
      : null;
    if (!course) {
      container.createDiv({ text: 'Open a course to see lesson notes.' });
      return;
    }

    container.createEl('h3', { text: 'Course Plan' });
    for (const lesson of this.sortedLessons(course)) {
      const plan = await this.loadLessonPlan(lesson);
      this.renderLesson(container, lesson, plan);
    }
  }

  private sortedLessons(course: CourseState): LessonSession[] {
    return [...course.lessons]
      .filter((lesson) => lesson.kind === 'lesson')
      .sort((a, b) => a.chapterNumber - b.chapterNumber);
  }

  private async loadLessonPlan(lesson: LessonSession): Promise<LearningLessonPlanContentBlock | null> {
    const plugin = this.plugin as ClaudianPlugin & {
      getConversationSync?: (id: string) => unknown;
      getConversationById?: (id: string) => Promise<unknown>;
    };
    const conversation = plugin.getConversationSync?.(lesson.conversationId)
      ?? await plugin.getConversationById?.(lesson.conversationId);
    if (!conversation || typeof conversation !== 'object') return null;

    const blocks: LearningLessonPlanContentBlock[] = [];
    const candidate = conversation as {
      uiMessageBlocks?: Record<string, MessageUiBlock[]>;
      messages?: Array<{ contentBlocks?: unknown[] }>;
    };

    for (const uiBlocks of Object.values(candidate.uiMessageBlocks ?? {})) {
      for (const block of uiBlocks) {
        if (isLessonPlanBlock(block)) blocks.push(block);
      }
    }
    for (const message of candidate.messages ?? []) {
      for (const block of message.contentBlocks ?? []) {
        if (isLessonPlanBlock(block)) blocks.push(block);
      }
    }

    return blocks.at(-1) ?? null;
  }

  private renderLesson(
    parent: HTMLElement,
    lesson: LessonSession,
    plan: LearningLessonPlanContentBlock | null,
  ): void {
    const group = parent.createDiv({ cls: 'ai-tutor-artifact-group' });
    const header = group.createDiv({ cls: 'ai-tutor-artifact-chapter-row' });
    header.createDiv({ cls: 'ai-tutor-artifact-chapter', text: `${lesson.chapterNumber}. ${lesson.title}` });
    header.createDiv({
      cls: 'ai-tutor-artifact-chapter-meta',
      text: `${lesson.status} · ${lesson.sections.length || plan?.parts.length || 0} parts`,
    });

    if (plan?.overview) {
      group.createDiv({ cls: 'ai-tutor-artifact-plan-overview', text: plan.overview });
    }

    if (plan && plan.parts.length > 0) {
      this.renderPlanParts(group, lesson, plan);
      if (plan.nextLessonSummary) {
        const next = group.createDiv({ cls: 'ai-tutor-artifact-next-lesson' });
        next.createSpan({ cls: 'ai-tutor-artifact-next-label', text: 'Next' });
        next.createSpan({ cls: 'ai-tutor-artifact-next-text', text: plan.nextLessonSummary });
      }
      return;
    }

    if (lesson.sections.length === 0) {
      group.createDiv({ cls: 'ai-tutor-artifact-empty', text: 'No sections planned yet.' });
      return;
    }

    for (const section of lesson.sections) {
      const row = group.createDiv({
        cls: `ai-tutor-artifact-row${section.missing ? ' is-missing' : ''}`,
      });
      row.createSpan({
        cls: 'ai-tutor-artifact-title',
        text: section.noteTitle ?? section.title,
      });
      row.createSpan({
        cls: 'ai-tutor-artifact-status',
        text: section.missing ? 'missing' : section.status,
      });
      row.addEventListener('click', () => {
        if (!section.notePath || section.missing) {
          new Notice('This lesson note is missing.');
          return;
        }
        void this.plugin.learningController.openNote(section.notePath);
      });
    }
  }

  private renderPlanParts(
    parent: HTMLElement,
    lesson: LessonSession,
    plan: LearningLessonPlanContentBlock,
  ): void {
    const list = parent.createDiv({ cls: 'ai-tutor-artifact-plan-parts' });
    for (const [index, part] of plan.parts.entries()) {
      const section = lesson.sections[index] ?? null;
      const row = list.createDiv({
        cls: `ai-tutor-artifact-plan-part${section?.missing ? ' is-missing' : ''}`,
      });
      const titleRow = row.createDiv({ cls: 'ai-tutor-artifact-plan-title-row' });
      titleRow.createSpan({ cls: 'ai-tutor-artifact-title', text: section?.noteTitle ?? part.title });
      titleRow.createSpan({
        cls: 'ai-tutor-artifact-status',
        text: this.planPartStatus(part.status, section?.status, section?.missing),
      });
      if (part.description) {
        row.createDiv({ cls: 'ai-tutor-artifact-plan-description', text: part.description });
      }
      const bulletPoints = part.bulletPoints?.map((point) => point.trim()).filter(Boolean).slice(0, 3) ?? [];
      if (bulletPoints.length > 0) {
        const bullets = row.createEl('ul', { cls: 'ai-tutor-artifact-plan-bullets' });
        for (const point of bulletPoints) {
          bullets.createEl('li', { text: point });
        }
      }
      const sources = part.sources?.filter((source) => !!sourceLabel(source)).slice(0, 3) ?? [];
      if (sources.length > 0) {
        const sourceRow = row.createDiv({ cls: 'ai-tutor-artifact-plan-sources' });
        for (const source of sources) {
          this.renderSourceChip(sourceRow, source);
        }
      }

      row.addEventListener('click', () => {
        if (!section?.notePath || section.missing) {
          new Notice('This lesson part does not have a note yet.');
          return;
        }
        void this.plugin.learningController.openNote(section.notePath);
      });
    }
  }

  private renderSourceChip(parent: HTMLElement, source: string | LearningLessonPlanSource): void {
    const label = sourceLabel(source);
    const path = sourcePath(source);
    if (!path) {
      parent.createSpan({ cls: 'ai-tutor-artifact-source', text: label });
      return;
    }

    const button = parent.createEl('button', {
      cls: 'ai-tutor-artifact-source is-clickable',
      text: label,
      attr: {
        type: 'button',
        title: `Open source: ${path}`,
      },
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.plugin.learningController.openSource(source);
    });
  }

  private planPartStatus(
    planStatus: LearningLessonPlanContentBlock['parts'][number]['status'],
    sectionStatus?: string,
    missing?: boolean,
  ): string {
    if (missing) return 'missing';
    if (sectionStatus === 'noteWritten' || sectionStatus === 'covered') return sectionStatus;
    if (planStatus === 'current') return 'now';
    if (planStatus === 'done') return 'done';
    if (planStatus === 'review') return 'review';
    return sectionStatus ?? 'pending';
  }
}
