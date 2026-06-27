import { ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from 'obsidian';

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
  private selectedLessonId: string | null = null;
  private readonly selectedPartByLessonId = new Map<string, number>();

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
    this.selectedLessonId = null;
    this.selectedPartByLessonId.clear();
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

    const selectedLessonId = this.resolveSelectedLessonId(course);
    container.createEl('h3', { text: '学习材料' });
    for (const lesson of this.sortedLessons(course)) {
      const plan = await this.loadLessonPlan(lesson);
      await this.renderLesson(container, lesson, plan, lesson.lessonId === selectedLessonId);
    }
  }

  private resolveSelectedLessonId(course: CourseState): string | null {
    const lessons = this.sortedLessons(course);
    if (this.selectedLessonId && lessons.some((lesson) => lesson.lessonId === this.selectedLessonId)) {
      return this.selectedLessonId;
    }
    const current = course.currentLessonId
      ? lessons.find((lesson) => lesson.lessonId === course.currentLessonId)
      : null;
    return current?.lessonId ?? lessons.at(-1)?.lessonId ?? null;
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

  private async renderLesson(
    parent: HTMLElement,
    lesson: LessonSession,
    plan: LearningLessonPlanContentBlock | null,
    isSelectedLesson: boolean,
  ): Promise<void> {
    const group = parent.createDiv({ cls: 'ai-tutor-artifact-group' });
    const header = group.createDiv({ cls: 'ai-tutor-artifact-chapter-row' });
    header.createDiv({ cls: 'ai-tutor-artifact-chapter', text: `${lesson.chapterNumber}. ${lesson.title}` });
    header.createDiv({
      cls: 'ai-tutor-artifact-chapter-meta',
      text: `${lesson.status} · ${lesson.sections.length || plan?.parts.length || 0} parts`,
    });
    header.addEventListener('click', () => {
      this.selectedLessonId = lesson.lessonId;
      void this.render();
    });

    if (plan?.overview) {
      group.createDiv({ cls: 'ai-tutor-artifact-plan-overview', text: plan.overview });
    }

    if (plan && plan.parts.length > 0) {
      const selectedPartIndex = this.resolveSelectedPartIndex(lesson, plan.parts.length);
      this.renderPlanParts(group, lesson, plan, selectedPartIndex, isSelectedLesson);
      if (isSelectedLesson) {
        await this.renderMaterialPanel(group, lesson, plan, selectedPartIndex);
      }
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

    const selectedPartIndex = this.resolveSelectedPartIndex(lesson, lesson.sections.length);
    for (const [index, section] of lesson.sections.entries()) {
      const row = group.createDiv({
        cls: [
          'ai-tutor-artifact-row',
          section.missing ? 'is-missing' : '',
          isSelectedLesson && index === selectedPartIndex ? 'is-selected' : '',
        ].filter(Boolean).join(' '),
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
        this.selectedLessonId = lesson.lessonId;
        this.selectedPartByLessonId.set(lesson.lessonId, index);
        void this.render();
        if (!section.notePath || section.missing) {
          new Notice('This lesson note is missing.');
          return;
        }
        void this.plugin.learningController.openNote(section.notePath);
      });
    }
    if (isSelectedLesson) {
      await this.renderMaterialPanel(group, lesson, null, selectedPartIndex);
    }
  }

  private renderPlanParts(
    parent: HTMLElement,
    lesson: LessonSession,
    plan: LearningLessonPlanContentBlock,
    selectedPartIndex: number,
    isSelectedLesson: boolean,
  ): void {
    const list = parent.createDiv({ cls: 'ai-tutor-artifact-plan-parts' });
    for (const [index, part] of plan.parts.entries()) {
      const section = lesson.sections[index] ?? null;
      const row = list.createDiv({
        cls: [
          'ai-tutor-artifact-plan-part',
          section?.missing ? 'is-missing' : '',
          isSelectedLesson && index === selectedPartIndex ? 'is-selected' : '',
        ].filter(Boolean).join(' '),
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
        this.selectedLessonId = lesson.lessonId;
        this.selectedPartByLessonId.set(lesson.lessonId, index);
        void this.render();
        if (!section?.notePath || section.missing) {
          return;
        }
        void this.plugin.learningController.openNote(section.notePath);
      });
    }
  }

  private resolveSelectedPartIndex(lesson: LessonSession, partCount: number): number {
    if (partCount <= 0) return 0;
    const selected = this.selectedPartByLessonId.get(lesson.lessonId);
    if (selected !== undefined && selected >= 0 && selected < partCount) {
      return selected;
    }
    if (lesson.currentSectionIndex >= 0 && lesson.currentSectionIndex < partCount) {
      return lesson.currentSectionIndex;
    }
    return 0;
  }

  private async renderMaterialPanel(
    parent: HTMLElement,
    lesson: LessonSession,
    plan: LearningLessonPlanContentBlock | null,
    selectedPartIndex: number,
  ): Promise<void> {
    const part = plan?.parts[selectedPartIndex] ?? null;
    const section = lesson.sections[selectedPartIndex] ?? null;
    const title = section?.noteTitle ?? section?.title ?? part?.title ?? lesson.title;

    const panel = parent.createDiv({ cls: 'ai-tutor-material-panel' });
    const heading = panel.createDiv({ cls: 'ai-tutor-material-heading' });
    heading.createDiv({ cls: 'ai-tutor-material-title', text: title });
    heading.createDiv({
      cls: 'ai-tutor-material-meta',
      text: `Chapter ${lesson.chapterNumber} · Part ${selectedPartIndex + 1}`,
    });

    await this.renderNoteMaterial(panel, section, title);
    await this.renderReferenceMaterials(panel, part?.sources ?? []);
  }

  private async renderNoteMaterial(
    parent: HTMLElement,
    section: LessonSession['sections'][number] | null,
    title: string,
  ): Promise<void> {
    const block = parent.createDiv({ cls: 'ai-tutor-material-section' });
    const header = block.createDiv({ cls: 'ai-tutor-material-section-header' });
    header.createDiv({ cls: 'ai-tutor-material-section-title', text: '笔记内容' });

    if (section?.notePath && !section.missing) {
      const open = header.createEl('button', {
        cls: 'ai-tutor-material-open',
        text: 'Open',
        attr: { type: 'button' },
      });
      open.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.plugin.learningController.openNote(section.notePath!);
      });
    }

    const body = block.createDiv({ cls: 'ai-tutor-material-body' });
    if (!section?.notePath) {
      body.createDiv({ cls: 'ai-tutor-material-empty', text: '这一节还没有生成笔记。' });
      return;
    }
    if (section.missing) {
      body.createDiv({ cls: 'ai-tutor-material-empty', text: '这篇笔记已被删除或移动，目录会保留缺失记录。' });
      return;
    }

    const content = await this.plugin.learningController.loadLessonNoteContent?.(section.notePath, title);
    if (!content) {
      body.createDiv({ cls: 'ai-tutor-material-empty', text: '还没有读到这篇笔记内容。' });
      return;
    }
    await this.renderMarkdown(body, content.text, content.path);
  }

  private async renderReferenceMaterials(
    parent: HTMLElement,
    sources: Array<string | LearningLessonPlanSource>,
  ): Promise<void> {
    const block = parent.createDiv({ cls: 'ai-tutor-material-section' });
    const header = block.createDiv({ cls: 'ai-tutor-material-section-header' });
    header.createDiv({ cls: 'ai-tutor-material-section-title', text: '参考资料' });

    const body = block.createDiv({ cls: 'ai-tutor-material-body is-reference-list' });
    const validSources = sources.filter((source) => !!sourceLabel(source));
    if (validSources.length === 0) {
      body.createDiv({ cls: 'ai-tutor-material-empty', text: '这一节还没有绑定参考资料。' });
      return;
    }

    for (const source of validSources) {
      const item = body.createDiv({ cls: 'ai-tutor-reference-card' });
      const itemHeader = item.createDiv({ cls: 'ai-tutor-reference-header' });
      itemHeader.createDiv({ cls: 'ai-tutor-reference-title', text: sourceLabel(source) });
      const path = sourcePath(source);
      if (path) {
        const open = itemHeader.createEl('button', {
          cls: 'ai-tutor-material-open',
          text: 'Open',
          attr: { type: 'button' },
        });
        open.addEventListener('click', (event) => {
          event.stopPropagation();
          void this.plugin.learningController.openSource(source);
        });
      }

      const content = await this.plugin.learningController.loadSourceContent?.(source);
      if (content) {
        const markdown = item.createDiv({ cls: 'ai-tutor-reference-content' });
        await this.renderMarkdown(markdown, content.text, content.path);
      } else {
        const fallback = item.createDiv({ cls: 'ai-tutor-reference-fallback' });
        fallback.createDiv({ text: sourceLabel(source) });
        if (typeof source !== 'string' && source.cardId) {
          fallback.createDiv({ text: `Card: ${source.cardId}` });
        } else if (path) {
          fallback.createDiv({ text: `Path: ${path}` });
        }
      }
    }
  }

  private async renderMarkdown(parent: HTMLElement, markdown: string, sourcePath: string): Promise<void> {
    try {
      await MarkdownRenderer.render(this.plugin.app, markdown, parent, sourcePath, this);
    } catch {
      parent.createEl('pre', { text: markdown });
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
