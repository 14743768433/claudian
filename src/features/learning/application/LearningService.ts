import type {
  LearningActivityContentBlock,
  LearningLessonPlanSource,
} from '../../../core/types';
import type { ChatTurnRequest } from '../../../core/runtime/types';
import { SkillSeeder } from './content/SkillSeeder';
import { TransformationRegistry } from './content/TransformationRegistry';
import { CommandCoordinator } from './coordinators/CommandCoordinator';
import { LessonProgression } from './coordinators/LessonProgression';
import { NavigationCoordinator } from './coordinators/NavigationCoordinator';
import { TurnCoordinator, type LearningTurnCompletion } from './coordinators/TurnCoordinator';
import { IndexRepository } from './IndexRepository';
import { learningAppendix } from './learningAppendix';
import { StateTransitionService } from './StateTransitionService';
import type { CourseIndexEntry, CourseState, LearningAction, LearningTurnMode, LessonSession, LoadedLessonRef } from '../domain/types';
import type { LearningActionApplier } from './LearningActionApplier';
import type { LearningOpenTab, LearningTurnPort } from '../ports/LearningTurnPort';
import type { LayoutPort } from '../ports/LayoutPort';
import type { NoticePort } from '../ports/NoticePort';
import type { StatePort } from '../ports/StatePort';
import type { VaultPort } from '../ports/VaultPort';
import { LearningReadModel, type LearningConversationStatus } from './LearningReadModel';
import { SourceLoader, type LessonNoteSnippet, type SourceSnippet } from './SourceLoader';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function messageLooksLikeAssistantResponse(message: unknown): boolean {
  if (!isRecord(message) || message.role !== 'assistant') return false;
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return true;
  }
  if (!Array.isArray(message.contentBlocks)) return false;
  return message.contentBlocks.some((block) => (
    isRecord(block)
    && block.type !== 'learning_activity'
    && block.type !== 'context_compacted'
  ));
}

function messagesHaveAssistantResponse(messages: unknown[] | undefined): boolean {
  return Array.isArray(messages) && messages.some(messageLooksLikeAssistantResponse);
}

export interface LearningServiceDependencies {
  adapter: VaultPort;
  layout: LayoutPort;
  turns: LearningTurnPort;
  notice: NoticePort;
  indexRepository: IndexRepository;
  stateService: LearningStateStore;
  stateMachine: LearningActionApplier;
  transitionService: StateTransitionService;
  progression: LessonProgression;
  skillSeeder: SkillSeeder;
  sourceLoader: SourceLoader;
}

export type LearningStateStore = StatePort & {
  currentLesson(course: CourseState): LessonSession | null;
};

function learningActivity(
  label: string,
  detail?: string,
  items?: string[],
): LearningActivityContentBlock {
  return {
    type: 'learning_activity',
    label,
    status: 'running',
    detail,
    items: items?.map((item) => item.trim()).filter(Boolean).slice(0, 8),
  };
}

function slugPathSegment(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || fallback;
}

function buildSectionNotePath(course: CourseState, lesson: LessonSession): string {
  const section = lesson.sections[lesson.currentSectionIndex];
  const chapterSlug = slugPathSegment(lesson.title, `chapter-${lesson.chapterNumber}`);
  const sectionSlug = slugPathSegment(section?.title ?? '', section?.id ?? `part-${lesson.currentSectionIndex + 1}`);
  const chapterDir = `${String(lesson.chapterNumber).padStart(3, '0')}-${chapterSlug}`;
  const noteFile = `part-${String(lesson.currentSectionIndex + 1).padStart(2, '0')}-${sectionSlug}.md`;
  return `${course.rootPath}/lessons/${chapterDir}/${noteFile}`;
}

function buildIntakeKickoffPrompt(course: CourseState, lesson: LessonSession): string {
  return [
    `请开始课程「${course.title}」的 intake。`,
    `Intake 会话：${lesson.title}`,
    `学习目标：${course.goalTitle}`,
    '',
    '不要空白等待，也不要只说“我准备好了”。请像 Heptabase AI Tutor 那样主动把学习启动起来：',
    '1. 先确认我的学习目标和当前材料状态。',
    '2. 告诉我现在最应该准备/读取哪些材料，按优先级列出来。',
    '3. 如果材料不足，问 2-4 个最关键的澄清问题；如果已经足够，可以给一个初版课程地图。',
    '4. 不要假装已经读过不存在的材料；不要输出 generateSyllabus action，除非我已经给了足够材料让你能生成可靠 syllabus。',
    '',
    '回复末尾请输出 ai-tutor-next-options JSON 块，例如：',
    '```ai-tutor-next-options',
    JSON.stringify({ options: ['我已经准备好材料', '先用现有目标生成大纲', '问我几个澄清问题'] }),
    '```',
  ].join('\n');
}

function buildPostSyllabusPlanningPrompt(course: CourseState): string {
  const topics = course.syllabus
    .slice(0, 8)
    .map((topic) => `${topic.order}. ${topic.title}${topic.summary ? ` - ${topic.summary}` : ''}`)
    .join('\n') || '当前大纲没有可用 topic。';

  return [
    `课程「${course.title}」的大纲已经保存。现在不要停在大纲，请继续规划第 1 章。`,
    `学习目标：${course.goalTitle}`,
    '',
    '已保存的大纲开头：',
    topics,
    '',
    '请按 Heptabase AI Tutor 的节奏完成这件事：',
    '1. 先用 2-4 句话说明第 1 章为什么从这里开始、承接了什么材料。',
    '2. 为第 1 章规划 3-6 个具体小节，每节标题要像可学习任务，不要只有抽象名词；每节给 description、3-5 条 bulletPoints、可用 sources。',
    '3. 在回复末尾输出 ```ai-tutor-action``` JSON，类型为 planChapter，写入 title、overview、sections、nextLessonSummary。sections 支持 title/description/bulletPoints/sources。',
    '4. 不要在这一轮写节笔记；planChapter 被插件接受后，插件会自动开始第 1 节教学。',
    '',
    '回复末尾也请输出 ai-tutor-next-options JSON 块，例如：',
    '```ai-tutor-next-options',
    JSON.stringify({ options: ['开始第 1 节', '调整第 1 章计划', '先问我一个澄清问题'] }),
    '```',
  ].join('\n');
}

function buildLessonKickoffPrompt(course: CourseState, lesson: LessonSession): string {
  const previousSummary = course.lessons
    .filter((candidate) => candidate.lessonId !== lesson.lessonId && candidate.coveredSummary)
    .slice(-1)[0]?.coveredSummary;
  const plannedSections = lesson.sections
    .map((section, index) => `${index + 1}. ${section.title} (${section.status})`)
    .join('\n');
  const hasPlannedSections = lesson.sections.length > 0;

  return [
    `请开始第 ${lesson.chapterNumber} 章「${lesson.title}」的学习。`,
    `课程目标：${course.goalTitle}`,
    previousSummary ? `上一章衔接摘要：${previousSummary}` : '上一章衔接摘要：如果上下文里没有摘要，请先说明当前只能基于课程目标和已有大纲启动。',
    '',
    hasPlannedSections
      ? '本章已经有小节计划，不要重新 planChapter；不要等待我再次确认，按 Heptabase 风格直接开始当前小节的教学。'
      : '不要等待我再次确认，按 Heptabase 风格直接完成这四件事：',
    ...(hasPlannedSections
      ? [
          '已规划小节：',
          plannedSections,
          '',
          '请先用 2-4 句话说明本章承接了什么、这一章要解决什么真实问题，然后直接开始第 1 节：讲 why、讲核心机制、给一个例子或检查题。',
        ]
      : [
          '1. 先用 2-4 句话说明本章承接了什么、这一章要解决什么真实问题。',
          '2. 规划本章 3-6 个小节，每节标题要具体、可学习，不要只有抽象概念名；每节给 description、3-5 条 bulletPoints、可用 sources。',
          '3. 在回复末尾输出一个 ```ai-tutor-action``` JSON，类型为 planChapter，写入 title、overview、sections、nextLessonSummary。sections 支持 title/description/bulletPoints/sources。',
          '4. 这一轮不要写节笔记；planChapter 被插件接受后，插件会自动开始第 1 节教学。',
        ]),
    '',
    '回复末尾请输出 ai-tutor-next-options JSON 块，例如：',
    '```ai-tutor-next-options',
    JSON.stringify({ options: ['继续讲深一点', '生成第 1 节笔记', '做一个小测', '开始下一节'] }),
    '```',
    '不要输出 startNewLesson action；现在已经在新章节会话里。',
  ].join('\n');
}

function buildSectionKickoffPrompt(course: CourseState, lesson: LessonSession): string {
  const section = lesson.sections[lesson.currentSectionIndex] ?? null;
  const previousSection = lesson.sections[lesson.currentSectionIndex - 1] ?? null;
  const sectionLabel = section
    ? `第 ${lesson.currentSectionIndex + 1}/${lesson.sections.length} 节「${section.title}」`
    : '当前小节';

  return [
    `请开始第 ${lesson.chapterNumber} 章 ${sectionLabel}的学习。`,
    `课程目标：${course.goalTitle}`,
    previousSection ? `上一节刚完成：${previousSection.title}` : '这是本章第一节或当前没有上一节记录。',
    '',
    '不要等待我再次确认；不要重新 planChapter；不要输出 startNewLesson action。',
    '直接做一轮清晰教学：先衔接上一节，再讲 why、核心机制、一个具体例子或检查题。',
    '本轮不要写节笔记，除非我明确要求“生成/写笔记”。',
    '',
    '回复末尾请输出 ai-tutor-next-options JSON 块，例如：',
    '```ai-tutor-next-options',
    JSON.stringify({ options: ['继续讲深一点', '生成本节笔记', '做一个小测', '开始下一节'] }),
    '```',
  ].join('\n');
}

function buildSectionNotePrompt(course: CourseState, lesson: LessonSession, notePath: string): string {
  const section = lesson.sections[lesson.currentSectionIndex] ?? null;
  const sectionTitle = section?.title ?? '当前小节';
  const sectionId = section?.id;
  const previousSection = lesson.sections[lesson.currentSectionIndex - 1] ?? null;

  return [
    `请为第 ${lesson.chapterNumber} 章「${lesson.title}」的当前小节写本节笔记。`,
    `当前小节：第 ${lesson.currentSectionIndex + 1}/${lesson.sections.length} 节「${sectionTitle}」`,
    previousSection ? `上一节：${previousSection.title}` : '上一节：这是本章第一节或当前没有上一节记录。',
    `课程目标：${course.goalTitle}`,
    `目标文件：${notePath}`,
    '',
    '请实际写入或覆盖这个 Markdown 文件，不要只在聊天里草拟。',
    '必须使用本轮注入的 lesson-page 模板：有具体开场、因果解释、结构化辅助、练习/检查、复习桥、类比、锐利总结和可追溯引用。',
    '如果上下文里没有可靠 source，请明确写出“当前缺少来源材料”，不要伪造引用。',
    '写完文件后，在回复末尾输出这个 action，让插件质量门检查并登记笔记：',
    '```ai-tutor-action',
    JSON.stringify({
      type: 'sectionNoteWritten',
      ...(sectionId ? { sectionId } : {}),
      notePath,
      noteTitle: sectionTitle,
    }),
    '```',
    '',
    '不要输出 advanceSection 或 startNewLesson；笔记通过质量门后，用户再决定是否进入下一节。',
    '',
    '回复末尾也请输出 ai-tutor-next-options JSON 块，例如：',
    '```ai-tutor-next-options',
    JSON.stringify({ options: ['开始下一节', '做一个小测', '继续讲深一点'] }),
    '```',
  ].join('\n');
}

function buildSourceContext(sourceSnippets: SourceSnippet[]): string {
  if (sourceSnippets.length === 0) return '';
  return [
    '<source_context>',
    'Use these vault source snippets as grounding. Cite them inline as [1], [2], etc. Do not invent facts outside them.',
    ...sourceSnippets.map((snippet, index) => [
      '',
      `[${index + 1}] ${snippet.label}`,
      `Path: ${snippet.path}`,
      '```markdown',
      snippet.text,
      '```',
    ].join('\n')),
    '</source_context>',
  ].join('\n');
}

function buildSectionNotePromptWithSources(
  course: CourseState,
  lesson: LessonSession,
  notePath: string,
  sourceSnippets: SourceSnippet[],
): string {
  const base = buildSectionNotePrompt(course, lesson, notePath);
  if (sourceSnippets.length === 0) return base;

  return `${buildSourceContext(sourceSnippets)}\n\n${base}`;
}

function buildSectionPracticePrompt(
  course: CourseState,
  lesson: LessonSession,
  quizTemplate: string,
  sourceSnippets: SourceSnippet[],
): string {
  const section = lesson.sections[lesson.currentSectionIndex] ?? null;
  const sectionTitle = section?.title ?? '当前小节';
  const previousSection = lesson.sections[lesson.currentSectionIndex - 1] ?? null;
  const sourceContext = buildSourceContext(sourceSnippets);
  const prompt = [
    `请为第 ${lesson.chapterNumber} 章「${lesson.title}」的当前小节生成一次小测/练习。`,
    `当前小节：第 ${lesson.currentSectionIndex + 1}/${lesson.sections.length} 节「${sectionTitle}」`,
    previousSection ? `上一节：${previousSection.title}` : '上一节：这是本章第一节或当前没有上一节记录。',
    `课程目标：${course.goalTitle}`,
    '',
    '请把它当成 Heptabase AI Tutor 的 checkpoint：帮助我发现是否真的理解，而不是做泛泛总结。',
    '',
    '必须遵守这个 quiz transformation：',
    '```text',
    quizTemplate,
    '```',
    '',
    '具体输出要求：',
    '1. 先用 1-2 句说明这次小测检查什么能力。',
    '2. 给 4-6 道题，至少包含：2 道为什么/机制题、1 道应用题、1 道常见误区题、1 个小任务。',
    '3. 每题都要能回扣当前小节；有 source snippet 时，题干或解析中用 [1]、[2] 引用。',
    '4. 答案和讲解放进 `<details><summary>答案和讲解</summary>` 中，默认让我可以先作答。',
    '5. 不要写文件，不要输出 ai-tutor-action，不要推进 section 或 startNewLesson。',
    '',
    '回复末尾请输出 ai-tutor-next-options JSON 块，例如：',
    '```ai-tutor-next-options',
    JSON.stringify({ options: ['我来回答这些题', '生成本节笔记', '继续讲深一点', '开始下一节'] }),
    '```',
  ].join('\n');

  return sourceContext ? `${sourceContext}\n\n${prompt}` : prompt;
}

function buildLessonNoteContext(noteSnippets: LessonNoteSnippet[]): string {
  if (noteSnippets.length === 0) return '';
  return [
    '<lesson_note_context>',
    'Use these already-registered lesson notes as grounding for the review. Cite them as [note 1], [note 2], etc. Do not invent finished material outside these notes and the conversation.',
    ...noteSnippets.map((snippet, index) => [
      '',
      `[note ${index + 1}] ${snippet.label}`,
      `Path: ${snippet.path}`,
      '```markdown',
      snippet.text,
      '```',
    ].join('\n')),
    '</lesson_note_context>',
  ].join('\n');
}

function buildLessonReviewPrompt(
  course: CourseState,
  lesson: LessonSession,
  reviewTemplate: string,
  noteSnippets: LessonNoteSnippet[],
): string {
  const sectionLines = lesson.sections.length > 0
    ? lesson.sections.map((section, index) => {
        const note = section.notePath ? ` note="${section.notePath}"` : '';
        return `${index + 1}. ${section.title} (${section.status})${note}`;
      }).join('\n')
    : 'No sections were registered for this chapter.';
  const noteContext = buildLessonNoteContext(noteSnippets);
  const prompt = [
    `请为第 ${lesson.chapterNumber} 章「${lesson.title}」生成一次章节复盘。`,
    `课程目标：${course.goalTitle}`,
    `当前章节状态：${lesson.status} / ${course.machineState}`,
    lesson.coveredSummary ? `已有结章摘要：${lesson.coveredSummary}` : '已有结章摘要：暂无，需基于本章对话和已登记笔记整理。',
    '',
    '本章小节：',
    sectionLines,
    '',
    '请把它当成 Heptabase AI Tutor 的 lesson review：收束本章能力、指出薄弱点、准备下一章，而不是泛泛总结。',
    '',
    '必须遵守这个 review transformation：',
    '```text',
    reviewTemplate,
    '```',
    '',
    '具体输出要求：',
    '1. 先用 2-3 句说明本章学完后应该具备的核心能力。',
    '2. 用 3-5 个小标题复盘关键知识，每个小标题都要有「为什么重要」和「容易错在哪里」。',
    '3. 加一个 Check Yourself：3-5 个自测问题，覆盖本章最关键的机制/应用/误区。',
    '4. 加一个 What to review next：说明下一章开始前最该带走的 2-4 个前置点。',
    '5. 如果有 lesson_note_context，请在关键复盘点引用 [note 1]、[note 2]。',
    '6. 不要写文件，不要输出 ai-tutor-action，不要推进 section 或 startNewLesson。',
    '',
    '回复末尾请输出 ai-tutor-next-options JSON 块，例如：',
    '```ai-tutor-next-options',
    JSON.stringify({ options: ['开始下一章', '再出一组小测', '把复盘改成清单', '我有问题要追问'] }),
    '```',
  ].join('\n');

  return noteContext ? `${noteContext}\n\n${prompt}` : prompt;
}

export class LearningService {
  readonly indexRepository: IndexRepository;
  readonly stateService: LearningStateStore;
  readonly stateMachine: LearningActionApplier;
  readonly transitionService: StateTransitionService;

  private readonly adapter: VaultPort;
  private readonly layout: LayoutPort;
  private readonly turns: LearningTurnPort;
  private readonly notice: NoticePort;
  private readonly transformationRegistry = new TransformationRegistry();
  private readonly progression: LessonProgression;
  private readonly skillSeeder: SkillSeeder;
  private readonly sourceLoader: SourceLoader;
  private readonly navigationCoordinator: NavigationCoordinator;
  private readonly commandCoordinator: CommandCoordinator;
  private readonly turnCoordinator: TurnCoordinator;
  private readonly conversationCache = new Map<string, LoadedLessonRef>();
  private readonly conversationTurnModes = new Map<string, LearningTurnMode>();
  private readonly readModel = new LearningReadModel(this.conversationCache, this.conversationTurnModes);
  private readonly lessonKickoffsInFlight = new Set<string>();

  constructor(deps: LearningServiceDependencies) {
    this.adapter = deps.adapter;
    this.layout = deps.layout;
    this.turns = deps.turns;
    this.notice = deps.notice;
    this.indexRepository = deps.indexRepository;
    this.stateService = deps.stateService;
    this.stateMachine = deps.stateMachine;
    this.transitionService = deps.transitionService;
    this.progression = deps.progression;
    this.skillSeeder = deps.skillSeeder;
    this.sourceLoader = deps.sourceLoader;
    this.navigationCoordinator = new NavigationCoordinator({
      layout: this.layout,
      notice: this.notice,
      stateService: this.stateService,
      stateMachine: this.stateMachine,
      sourceLoader: this.sourceLoader,
      cacheCourse: (course) => this.cacheCourse(course),
      ensureLessonConversation: (course, lesson) => this.ensureLessonConversation(course, lesson),
      openChatConversation: (conversationId) => this.openChatConversation(conversationId),
    });
    this.commandCoordinator = new CommandCoordinator({
      courseLookup: this.stateService,
      readModel: this.readModel,
      progression: this.progression,
      notice: this.notice,
      actions: {
        cacheCourse: (course) => this.cacheCourse(course),
        refreshOpenLearningViews: (courseId) => this.refreshOpenLearningViews(courseId),
        refreshOpenChatLearningControls: () => this.refreshOpenChatLearningControls(),
        maybeKickoffPostAdvance: (conversationId, state) => this.maybeKickoffPostAdvance(conversationId, state),
        openChatConversation: (conversationId) => this.openChatConversation(conversationId),
        sendSectionNoteTurn: (conversationId, ref) => this.sendSectionNoteTurn(conversationId, ref),
        sendSectionPracticeTurn: (conversationId, ref) => this.sendSectionPracticeTurn(conversationId, ref),
        sendLessonReviewTurn: (conversationId, course, lesson) => this.sendLessonReviewTurn(conversationId, course, lesson),
      },
      hasAssistantResponse: (conversationId) => this.hasConversationAssistantResponse(conversationId),
    });
    this.turnCoordinator = new TurnCoordinator({
      stateService: this.stateService,
      vault: this.adapter,
      turns: this.turns,
      notice: this.notice,
      progression: this.progression,
      readModel: this.readModel,
      cacheCourse: (course) => this.cacheCourse(course),
      refreshOpenLearningViews: (courseId) => this.refreshOpenLearningViews(courseId),
      openChatConversation: (conversationId) => this.openChatConversation(conversationId),
      maybeKickoffPostAdvance: (conversationId, state) => this.maybeKickoffPostAdvance(conversationId, state),
      maybeKickoffFirstLessonPlanning: (conversationId, state) => this.maybeKickoffFirstLessonPlanning(conversationId, state),
      refreshConversationCache: () => this.refreshConversationCache(),
      refreshOpenChatLearningControls: () => this.refreshOpenChatLearningControls(),
      getLoadedLessonRefSync: (conversationId) => this.conversationCache.get(conversationId) ?? null,
      getConversationTurnMode: (conversationId) => this.getConversationTurnMode(conversationId),
    });
  }

  async initialize(): Promise<void> {
    for (const course of await this.stateService.listCourses()) {
      await this.indexRepository.refreshFromCourseState(course);
    }
    await this.refreshConversationCache();
    await this.skillSeeder.seedVaultSkills().catch(() => {
      this.notice.notify('AI Tutor could not seed .claude skill templates.');
    });
  }

  getSystemPromptAppendices(): string[] {
    return [learningAppendix()];
  }

  async listCourseEntries(): Promise<CourseIndexEntry[]> {
    return this.indexRepository.listCourses();
  }

  async loadCourse(courseId: string): Promise<CourseState | null> {
    return this.stateService.loadCourse(courseId);
  }

  async loadCurrentCourse(): Promise<CourseState | null> {
    return this.stateService.loadCurrentCourse();
  }

  async createCourse(input: { title: string; goalTitle: string }): Promise<CourseState> {
    const conversation = await this.turns.createConversation();
    await this.turns.renameConversation(conversation.id, `${input.title} · Intake`);
    const result = await this.transitionService.createCourse({
      title: input.title,
      goalTitle: input.goalTitle,
      intakeConversationId: conversation.id,
    });
    if (!result.ok || !result.state) {
      throw new Error(result.message ?? 'AI Tutor could not create the course.');
    }
    const course = result.state;
    this.cacheCourse(course);
    this.notice.notify('Course created. Read or add source material, then ask AI Tutor to plan the course.');
    await this.enterCourse(course.courseId);
    return course;
  }

  async openLibrary(): Promise<void> {
    await this.navigationCoordinator.openLibrary();
  }

  async enterCourse(courseId: string): Promise<void> {
    await this.navigationCoordinator.enterCourse(courseId);
  }

  async enterLesson(courseId: string, lessonId: string): Promise<void> {
    await this.navigationCoordinator.enterLesson(courseId, lessonId);
  }

  canStartNewLesson(conversationId: string | null): boolean {
    return this.readModel.canStartNewLesson(conversationId);
  }

  canAdvanceSection(conversationId: string | null): boolean {
    return this.readModel.canAdvanceSection(conversationId);
  }

  canWriteSectionNote(conversationId: string | null): boolean {
    return this.readModel.canWriteSectionNote(conversationId);
  }

  canPracticeSection(conversationId: string | null): boolean {
    return this.readModel.canPracticeSection(conversationId);
  }

  canReviewLesson(conversationId: string | null): boolean {
    return this.readModel.canReviewLesson(conversationId);
  }

  getAdvanceSectionLabel(conversationId: string | null): string | null {
    return this.readModel.getAdvanceSectionLabel(conversationId);
  }

  getConversationStatus(conversationId: string | null): LearningConversationStatus | null {
    return this.readModel.getConversationStatus(conversationId);
  }

  setConversationTurnMode(conversationId: string | null, mode: LearningTurnMode): boolean {
    return this.readModel.setConversationTurnMode(conversationId, mode);
  }

  getConversationTurnMode(conversationId: string | null): LearningTurnMode {
    return this.readModel.getConversationTurnMode(conversationId);
  }

  async handleUserCommand(conversationId: string | null, text: string): Promise<boolean> {
    return this.commandCoordinator.handleUserCommand(conversationId, text);
  }

  async advanceSectionFromConversation(conversationId: string): Promise<void> {
    await this.commandCoordinator.advanceSectionFromConversation(conversationId);
  }

  async writeSectionNoteFromConversation(conversationId: string): Promise<void> {
    await this.commandCoordinator.writeSectionNoteFromConversation(conversationId);
  }

  async practiceSectionFromConversation(conversationId: string): Promise<void> {
    await this.commandCoordinator.practiceSectionFromConversation(conversationId);
  }

  async reviewLessonFromConversation(conversationId: string): Promise<void> {
    await this.commandCoordinator.reviewLessonFromConversation(conversationId);
  }

  async startNewLessonFromConversation(
    conversationId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    await this.commandCoordinator.startNewLessonFromConversation(conversationId, options);
  }

  async arrangeLearningLayout(courseId: string): Promise<void> {
    await this.navigationCoordinator.arrangeLearningLayout(courseId);
  }

  decorateTurnRequestSync(
    conversationId: string | null,
    request: ChatTurnRequest,
    conversationMessageCount: number,
  ): ChatTurnRequest {
    return this.turnCoordinator.decorateTurnRequestSync(conversationId, request, conversationMessageCount);
  }

  async handleAssistantTurnComplete(
    conversationId: string,
    assistantContent: string,
    assistantMessageId?: string,
  ): Promise<LearningTurnCompletion> {
    return this.turnCoordinator.handleAssistantTurnComplete(conversationId, assistantContent, assistantMessageId);
  }

  async openNote(path: string): Promise<void> {
    await this.navigationCoordinator.openNote(path);
  }

  async openSource(source: string | LearningLessonPlanSource): Promise<void> {
    await this.navigationCoordinator.openSource(source);
  }

  async handleVaultRename(oldPath: string, newPath: string): Promise<void> {
    for (const course of await this.stateService.listCourses()) {
      const result = await this.stateMachine.applyAction(course.courseId, {
        type: 'noteRenamed',
        oldPath,
        newPath,
      });
      if (result.ok && result.state) {
        this.cacheCourse(result.state);
        await this.refreshOpenLearningViews(result.state.courseId);
      }
    }
  }

  async handleVaultDelete(path: string): Promise<void> {
    for (const course of await this.stateService.listCourses()) {
      const result = await this.stateMachine.applyAction(course.courseId, {
        type: 'noteDeleted',
        path,
      });
      if (result.ok && result.state) {
        this.cacheCourse(result.state);
        await this.refreshOpenLearningViews(result.state.courseId);
      }
    }
  }

  private async sendSectionNoteTurn(conversationId: string, ref: LoadedLessonRef): Promise<boolean> {
    const section = ref.lesson.sections[ref.lesson.currentSectionIndex];
    const tab = await this.findOpenTabForConversation(conversationId);
    if (!tab || tab.isStreaming) {
      return false;
    }

    const notePath = buildSectionNotePath(ref.course, ref.lesson);
    const sourceSnippets = await this.sourceLoader.loadCurrentSectionSourceSnippets(ref.lesson);
    await tab.sendHiddenTurn({
      content: buildSectionNotePromptWithSources(ref.course, ref.lesson, notePath, sourceSnippets),
      displayContent: `生成本节笔记：${section.title}`,
      learningActivity: learningActivity(
        'Writing section note',
        `Section ${ref.lesson.currentSectionIndex + 1}/${ref.lesson.sections.length}: ${section.title}`,
        [
          section.title,
          notePath,
          sourceSnippets.length > 0 ? `${sourceSnippets.length} source snippets` : 'No source snippets resolved',
          'Run quality gate',
        ],
      ),
    });
    return true;
  }

  private async sendSectionPracticeTurn(conversationId: string, ref: LoadedLessonRef): Promise<boolean> {
    const section = ref.lesson.sections[ref.lesson.currentSectionIndex];
    const tab = await this.findOpenTabForConversation(conversationId);
    if (!tab || tab.isStreaming) {
      return false;
    }

    const sourceSnippets = await this.sourceLoader.loadCurrentSectionSourceSnippets(ref.lesson);
    await tab.sendHiddenTurn({
      content: buildSectionPracticePrompt(
        ref.course,
        ref.lesson,
        this.transformationRegistry.get('quiz').body,
        sourceSnippets,
      ),
      displayContent: `小测：${section.title}`,
      learningActivity: learningActivity(
        'Preparing practice',
        `Section ${ref.lesson.currentSectionIndex + 1}/${ref.lesson.sections.length}: ${section.title}`,
        [
          section.title,
          sourceSnippets.length > 0 ? `${sourceSnippets.length} source snippets` : 'No source snippets resolved',
          'Generate checkpoint questions',
        ],
      ),
    });
    return true;
  }

  private async ensureLessonConversation(course: CourseState, lesson: LessonSession): Promise<CourseState> {
    if (this.turns.hasConversation(lesson.conversationId)) {
      return course;
    }
    const replacement = await this.turns.createConversation();
    await this.turns.renameConversation(replacement.id, `${course.title} · ${lesson.title}`);
    const result = await this.stateMachine.applyAction(course.courseId, {
      type: 'conversationReplaced',
      lessonId: lesson.lessonId,
      conversationId: replacement.id,
    });
    if (result.ok && result.state) {
      this.notice.notify('AI Tutor recreated a missing chapter conversation.');
      return result.state;
    }
    this.notice.notify(result.message ?? 'AI Tutor could not recreate the missing chapter conversation.');
    return course;
  }

  private async openChatConversation(conversationId: string): Promise<void> {
    await this.layout.focusChatForConversation(conversationId);
    this.refreshOpenChatLearningControls();
    const kickedOff = await this.maybeKickoffCurrentLesson(conversationId, { retryTabLookup: true });
    if (!kickedOff) {
      this.refreshOpenChatLearningControls();
    }
  }

  private async maybeKickoffCurrentLesson(
    conversationId: string,
    options: { retryTabLookup?: boolean } = {},
  ): Promise<boolean> {
    if (this.lessonKickoffsInFlight.has(conversationId)) {
      return false;
    }

    const ref = await this.stateService.findByConversationId(conversationId);
    if (!ref) return false;

    const { course, lesson } = ref;
    const shouldKickoffIntake = lesson.kind === 'intake' && course.machineState === 'intake';
    const shouldKickoffLesson = lesson.kind === 'lesson'
      && (course.machineState === 'chapterPlanning' || course.machineState === 'teaching');
    if (
      course.currentLessonId !== lesson.lessonId
      || lesson.status !== 'active'
      || (!shouldKickoffIntake && !shouldKickoffLesson)
    ) {
      return false;
    }

    if (await this.hasConversationAssistantResponse(conversationId)) {
      return false;
    }

    const tab = await this.findOpenTabForConversation(conversationId, options.retryTabLookup ? 4 : 1);
    if (!tab) {
      this.notice.notify('AI Tutor opened the chapter but could not find the chat tab to start it. Open the course again to retry.');
      return false;
    }
    if (tab.isStreaming || messagesHaveAssistantResponse(tab.messages)) {
      return false;
    }

    this.lessonKickoffsInFlight.add(conversationId);
    try {
      await tab.sendHiddenTurn({
        content: shouldKickoffIntake
          ? buildIntakeKickoffPrompt(course, lesson)
          : buildLessonKickoffPrompt(course, lesson),
        displayContent: shouldKickoffIntake
          ? `开始课程 intake：${course.title}`
          : `开始第 ${lesson.chapterNumber} 章：${lesson.title}`,
        learningActivity: shouldKickoffIntake
          ? learningActivity('Starting course intake', course.title, ['Clarify goal', 'Prioritize materials', 'Prepare course map'])
          : learningActivity(
            lesson.sections.length > 0 ? 'Starting chapter section' : 'Planning chapter',
            `Chapter ${lesson.chapterNumber}: ${lesson.title}`,
            lesson.sections.length > 0
              ? lesson.sections.map((section) => section.title)
              : ['Read continuity', 'Plan 3-6 sections', 'Begin section 1'],
          ),
      });
      return true;
    } finally {
      this.lessonKickoffsInFlight.delete(conversationId);
    }
  }

  private async maybeKickoffAdvancedSection(
    conversationId: string,
    state: CourseState,
  ): Promise<void> {
    const lesson = this.stateService.currentLesson(state);
    if (
      !lesson
      || lesson.conversationId !== conversationId
      || lesson.kind !== 'lesson'
      || lesson.status !== 'active'
      || state.machineState !== 'teaching'
      || lesson.sections.length === 0
    ) {
      return;
    }

    const section = lesson.sections[lesson.currentSectionIndex] ?? null;
    if (!section || section.status !== 'pending') {
      return;
    }

    const tab = await this.findOpenTabForConversation(conversationId);
    if (!tab || tab.isStreaming) {
      return;
    }

    await tab.sendHiddenTurn({
      content: buildSectionKickoffPrompt(state, lesson),
      displayContent: `开始第 ${lesson.currentSectionIndex + 1} 节：${section.title}`,
      learningActivity: learningActivity(
        'Starting next section',
        `Section ${lesson.currentSectionIndex + 1}/${lesson.sections.length}: ${section.title}`,
        lesson.sections.map((candidate, index) => (
          index === lesson.currentSectionIndex ? `Now: ${candidate.title}` : candidate.title
        )),
      ),
    });
  }

  private async maybeKickoffPostAdvance(
    conversationId: string,
    state: CourseState,
  ): Promise<void> {
    const lesson = this.stateService.currentLesson(state);
    if (
      lesson
      && lesson.conversationId === conversationId
      && this.readModel.isReviewLessonReady({ course: state, lesson })
    ) {
      await this.sendLessonReviewTurn(conversationId, state, lesson);
      return;
    }

    await this.maybeKickoffAdvancedSection(conversationId, state);
  }

  private async sendLessonReviewTurn(
    conversationId: string,
    course: CourseState,
    lesson: LessonSession,
  ): Promise<boolean> {
    const tab = await this.findOpenTabForConversation(conversationId);
    if (!tab || tab.isStreaming) {
      return false;
    }

    const noteSnippets = await this.sourceLoader.loadLessonNoteSnippets(lesson);
    await tab.sendHiddenTurn({
      content: buildLessonReviewPrompt(
        course,
        lesson,
        this.transformationRegistry.get('review').body,
        noteSnippets,
      ),
      displayContent: `复盘本章：${lesson.title}`,
      learningActivity: learningActivity(
        'Preparing chapter review',
        `Chapter ${lesson.chapterNumber}: ${lesson.title}`,
        [
          `${lesson.sections.length} sections`,
          noteSnippets.length > 0 ? `${noteSnippets.length} lesson note snippets` : 'No lesson note snippets resolved',
          'Generate review bridge',
        ],
      ),
    });
    return true;
  }

  private async maybeKickoffFirstLessonPlanning(
    conversationId: string,
    state: CourseState,
  ): Promise<void> {
    const lesson = this.stateService.currentLesson(state);
    if (
      !lesson
      || lesson.conversationId !== conversationId
      || lesson.kind !== 'intake'
      || lesson.status !== 'active'
      || state.machineState !== 'chapterPlanning'
      || state.syllabus.length === 0
    ) {
      return;
    }

    const tab = await this.findOpenTabForConversation(conversationId);
    if (!tab || tab.isStreaming) {
      return;
    }

    await tab.sendHiddenTurn({
      content: buildPostSyllabusPlanningPrompt(state),
      displayContent: `规划第 1 章：${state.title}`,
      learningActivity: learningActivity(
        'Planning first chapter',
        state.title,
        state.syllabus.map((topic) => topic.title),
      ),
    });
  }

  private async findOpenTabForConversation(
    conversationId: string,
    attempts = 1,
  ): Promise<LearningOpenTab | null> {
    return this.turns.findOpenTabForConversation(conversationId, attempts);
  }

  private async refreshOpenLearningViews(courseId: string): Promise<void> {
    await this.navigationCoordinator.refreshOpenLearningViews(courseId);
  }

  private refreshOpenChatLearningControls(): void {
    this.navigationCoordinator.refreshOpenChatLearningControls();
  }

  private async refreshConversationCache(): Promise<void> {
    this.conversationCache.clear();
    for (const course of await this.stateService.listCourses()) {
      this.cacheCourse(course);
    }
  }

  private cacheCourse(course: CourseState): void {
    for (const lesson of course.lessons) {
      this.conversationCache.set(lesson.conversationId, { course, lesson });
    }
  }

  private async hasConversationAssistantResponse(conversationId: string): Promise<boolean> {
    return this.turns.hasAssistantResponse(conversationId);
  }
}
