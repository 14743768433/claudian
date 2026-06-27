import type {
  Conversation,
  LearningActionResultContentBlock,
  LearningLessonPlanContentBlock,
  LearningLessonPlanSource,
  LearningNextStepsContentBlock,
  MessageUiBlock,
} from '../../../../core/types';
import type { ChatTurnRequest } from '../../../../core/runtime/types';
import { ActionRequestChannel } from '../ActionRequestChannel';
import { LearningContextInjector } from '../../context/LearningContextInjector';
import type { LearningTurnPort } from '../../ports/LearningTurnPort';
import type { NoticePort } from '../../ports/NoticePort';
import type { CourseState, LearningAction, LearningTurnMode, LessonSession, LoadedLessonRef } from '../../state/types';
import { sourcePathFromText } from '../SourceLoader';
import type { LessonProgression } from './LessonProgression';

export interface LearningActionOutcome {
  actionType: string;
  label: string;
  status: 'accepted' | 'rejected';
  detail?: string;
  message?: string;
  items?: string[];
  lessonPlan?: LearningLessonPlanContentBlock;
}

export interface LearningTurnCompletion {
  repairPrompt: string | null;
  actionOutcomes: LearningActionOutcome[];
  nextSteps: LearningNextStepsContentBlock[];
}

export interface LearningTurnStateService {
  findByConversationId(conversationId: string): Promise<LoadedLessonRef | null>;
  loadCourse(courseId: string, rootPath?: string): Promise<CourseState | null>;
  currentLesson(course: CourseState): LessonSession | null;
}

export interface LearningTurnReadModel {
  isReviewLessonReady(ref: LoadedLessonRef): boolean;
}

export interface TurnCoordinatorDependencies {
  stateService: LearningTurnStateService;
  turns: LearningTurnPort;
  notice: NoticePort;
  progression: LessonProgression;
  readModel: LearningTurnReadModel;
  checkNoteQuality(notePath: string): Promise<{ pass: boolean; reasons: string[] }>;
  buildRepairPrompt(conversationId: string, notePath: string, reasons: string[]): string | null;
  clearRepairAttempt(conversationId: string, notePath: string): void;
  cacheCourse(course: CourseState): void;
  refreshOpenLearningViews(courseId: string): Promise<void>;
  openChatConversation(conversationId: string): Promise<void>;
  maybeKickoffPostAdvance(conversationId: string, state: CourseState): Promise<void>;
  maybeKickoffFirstLessonPlanning(conversationId: string, state: CourseState): Promise<void>;
  refreshConversationCache(): Promise<void>;
  refreshOpenChatLearningControls(): void;
  getLoadedLessonRefSync(conversationId: string): LoadedLessonRef | null;
  getConversationTurnMode(conversationId: string): LearningTurnMode;
}

function actionNeedsQualityGate(action: LearningAction): action is Extract<LearningAction, { type: 'sectionNoteWritten' }> {
  return action.type === 'sectionNoteWritten';
}

function emptyLearningTurnCompletion(): LearningTurnCompletion {
  return { repairPrompt: null, actionOutcomes: [], nextSteps: [] };
}

function describeLearningAction(action: LearningAction): Omit<LearningActionOutcome, 'status' | 'message'> {
  switch (action.type) {
    case 'generateSyllabus':
      return {
        actionType: action.type,
        label: 'Save course map',
        detail: action.topics.length > 0 ? `${action.topics.length} topics` : undefined,
        items: action.topics.map((topic) => topic.title.trim()).filter(Boolean).slice(0, 8),
      };
    case 'planChapter': {
      const title = action.title.trim() || 'current chapter';
      return {
        actionType: action.type,
        label: 'Plan chapter',
        detail: action.sections.length > 0 ? `${title} - ${action.sections.length} sections` : title,
        items: action.sections.map((section) => section.title.trim()).filter(Boolean).slice(0, 8),
      };
    }
    case 'sectionNoteWritten':
      return {
        actionType: action.type,
        label: 'Register section note',
        detail: action.noteTitle?.trim() || action.notePath,
      };
    case 'advanceSection':
      return { actionType: action.type, label: 'Advance section' };
    case 'startNewLesson':
      return {
        actionType: action.type,
        label: 'Start new lesson',
        detail: action.title?.trim() || undefined,
        items: action.sections?.map((section) => section.title.trim()).filter(Boolean).slice(0, 8),
      };
    default:
      return { actionType: action.type, label: 'Apply system update' };
  }
}

function withAcceptedStateContext(
  outcome: LearningActionOutcome,
  action: LearningAction,
  state: CourseState | undefined,
): LearningActionOutcome {
  if (!state) return outcome;
  const currentLesson = state.lessons.find((lesson) => lesson.lessonId === state.currentLessonId);

  if (action.type === 'advanceSection') {
    if (state.machineState === 'chapterEnded') {
      return {
        ...outcome,
        detail: 'Chapter complete',
        message: 'Chapter finished. Start new lesson is ready.',
      };
    }

    const section = currentLesson?.sections[currentLesson.currentSectionIndex];
    if (!section) return outcome;
    return {
      ...outcome,
      detail: `Next: ${section.title}`,
      message: 'Next section started.',
    };
  }

  if (action.type === 'startNewLesson' && currentLesson) {
    return {
      ...outcome,
      detail: `Chapter ${currentLesson.chapterNumber}: ${currentLesson.title}`,
      items: currentLesson.sections.map((section) => section.title).filter(Boolean).slice(0, 8),
    };
  }

  return outcome;
}

function acceptedMessageForLearningAction(action: LearningAction): string {
  switch (action.type) {
    case 'generateSyllabus':
      return 'Course map saved.';
    case 'planChapter':
      return 'Chapter plan saved.';
    case 'sectionNoteWritten':
      return 'Section note registered.';
    case 'advanceSection':
      return 'Next section started.';
    case 'startNewLesson':
      return 'New lesson conversation opened.';
    default:
      return 'System update saved.';
  }
}

function toLearningActionBlock(outcome: LearningActionOutcome): LearningActionResultContentBlock {
  return {
    type: 'learning_action_result',
    actionType: outcome.actionType,
    label: outcome.label,
    status: outcome.status,
    detail: outcome.detail,
    message: outcome.message,
    items: outcome.items,
  };
}

function learningActionOutcomeBlocks(outcomes: LearningActionOutcome[]): MessageUiBlock[] {
  return outcomes.flatMap((outcome) => {
    const blocks: MessageUiBlock[] = [toLearningActionBlock(outcome)];
    if (outcome.lessonPlan) {
      blocks.push(outcome.lessonPlan);
    }
    return blocks;
  });
}

function formatPlanSource(source: unknown): string | LearningLessonPlanSource | null {
  if (typeof source === 'string') {
    const label = source.trim();
    return label ? { label, path: sourcePathFromText(label) ?? undefined } : null;
  }
  if (!source || typeof source !== 'object') return null;
  const value = source as { text?: unknown; cardId?: unknown; path?: unknown };
  const path = typeof value.path === 'string' && value.path.trim()
    ? value.path.trim()
    : undefined;
  const cardId = typeof value.cardId === 'string' && value.cardId.trim()
    ? value.cardId.trim()
    : undefined;
  const label = typeof value.text === 'string' && value.text.trim()
    ? value.text.trim()
    : path ?? cardId ?? null;
  if (!label) return null;
  return { label, path, cardId };
}

function buildLessonPlanBlock(
  action: LearningAction,
  state: CourseState | undefined,
): LearningLessonPlanContentBlock | undefined {
  if (action.type !== 'planChapter' || !state) return undefined;
  const lesson = state.lessons.find((item) => item.lessonId === state.currentLessonId);
  const title = action.title.trim() || lesson?.title || 'Current chapter';
  const parts = action.sections
    .map((section, index) => {
      const titleText = section.title.trim();
      if (!titleText) return null;
      const sources = section.sources
        ?.map(formatPlanSource)
        .filter((source): source is string | LearningLessonPlanSource => !!source)
        .slice(0, 4);
      return {
        title: titleText,
        status: index === 0 ? 'current' as const : 'pending' as const,
        description: section.description?.trim() || undefined,
        bulletPoints: section.bulletPoints?.map((point) => point.trim()).filter(Boolean).slice(0, 5),
        sources: sources && sources.length > 0 ? sources : undefined,
      };
    })
    .filter((part): part is NonNullable<typeof part> => !!part)
    .slice(0, 8);
  if (parts.length === 0) return undefined;

  return {
    type: 'learning_lesson_plan',
    title,
    overview: action.overview?.trim() || undefined,
    detail: lesson ? `Chapter ${lesson.chapterNumber}` : undefined,
    parts,
    nextLessonSummary: action.nextLessonSummary?.trim() || undefined,
  };
}

function chapterReviewNextSteps(lesson: LessonSession): LearningNextStepsContentBlock {
  return {
    type: 'learning_next_steps',
    label: 'Next',
    detail: `Chapter ${lesson.chapterNumber} review complete`,
    options: ['Start new lesson', '复盘本章', '我还有一个问题'],
  };
}

export class TurnCoordinator {
  private readonly actionChannel = new ActionRequestChannel();
  private readonly contextInjector = new LearningContextInjector();

  constructor(private readonly deps: TurnCoordinatorDependencies) {}

  decorateTurnRequestSync(
    conversationId: string | null,
    request: ChatTurnRequest,
    conversationMessageCount: number,
  ): ChatTurnRequest {
    if (!conversationId) return request;
    const ref = this.deps.getLoadedLessonRefSync(conversationId);
    if (!ref) return request;
    return this.contextInjector.decorateRequest({
      course: ref.course,
      lesson: ref.lesson,
      conversationMessageCount,
      request,
      selectedTurnMode: this.deps.getConversationTurnMode(conversationId),
    });
  }

  async handleAssistantTurnComplete(
    conversationId: string,
    assistantContent: string,
    assistantMessageId?: string,
  ): Promise<LearningTurnCompletion> {
    const ref = await this.deps.stateService.findByConversationId(conversationId);
    if (!ref) return emptyLearningTurnCompletion();

    const schemaCheck = await this.deps.stateService.loadCourse(ref.course.courseId, ref.course.rootPath);
    if (!schemaCheck) {
      this.deps.notice.notify('AI Tutor course-state.json is invalid or missing.');
      return emptyLearningTurnCompletion();
    }

    const requests = this.actionChannel.parse(assistantContent);
    if (requests.length === 0) {
      const nextSteps = await this.persistReviewNextStepsIfNeeded(conversationId, assistantMessageId, ref.course, ref.lesson);
      return { repairPrompt: null, actionOutcomes: [], nextSteps };
    }

    let latestState: CourseState | null = null;
    let repairPrompt: string | null = null;
    const actionOutcomes: LearningActionOutcome[] = [];
    let shouldOpenStartedLesson = false;
    let shouldKickoffFirstLessonPlanning = false;
    let shouldKickoffAdvancedSection = false;
    for (const request of requests) {
      const actionSummary = describeLearningAction(request.action);
      if (actionNeedsQualityGate(request.action)) {
        const gate = await this.deps.checkNoteQuality(request.action.notePath);
        if (!gate.pass) {
          this.deps.notice.notify(`AI Tutor note quality gate failed: ${gate.reasons.join(' ')}`);
          actionOutcomes.push({
            ...actionSummary,
            status: 'rejected',
            message: `Quality gate failed: ${gate.reasons.join(' ')}`,
          });
          repairPrompt = this.deps.buildRepairPrompt(conversationId, request.action.notePath, gate.reasons);
          continue;
        }
        this.deps.clearRepairAttempt(conversationId, request.action.notePath);
      }

      const result = request.action.type === 'startNewLesson'
        ? await this.deps.progression.startNewLesson(ref.course.courseId, request.action, ref.lesson)
        : request.action.type === 'advanceSection'
          ? await this.deps.progression.advanceSection(ref.course.courseId, request.action)
          : await this.deps.progression.applyAssistantAction(ref.course.courseId, request.action);

      if (!result.ok) {
        this.deps.notice.notify(result.message ?? 'AI Tutor action was rejected.');
        actionOutcomes.push({
          ...actionSummary,
          status: 'rejected',
          message: result.message ?? 'Action rejected by state machine.',
        });
        continue;
      }
      const acceptedOutcome = withAcceptedStateContext({
        ...actionSummary,
        status: 'accepted',
        message: acceptedMessageForLearningAction(request.action),
      }, request.action, result.state);
      actionOutcomes.push({
        ...acceptedOutcome,
        lessonPlan: buildLessonPlanBlock(request.action, result.state),
      });
      latestState = result.state ?? null;
      if (request.action.type === 'startNewLesson') {
        shouldOpenStartedLesson = true;
      } else if (request.action.type === 'generateSyllabus') {
        shouldKickoffFirstLessonPlanning = true;
      } else if (request.action.type === 'advanceSection') {
        shouldKickoffAdvancedSection = true;
      } else if (request.action.type === 'planChapter') {
        shouldKickoffAdvancedSection = true;
      }
    }

    await this.persistActionOutcomes(conversationId, assistantMessageId, actionOutcomes);

    if (latestState) {
      this.deps.cacheCourse(latestState);
      await this.deps.refreshOpenLearningViews(latestState.courseId);
      const current = this.deps.stateService.currentLesson(latestState);
      if (shouldOpenStartedLesson && current) {
        await this.deps.openChatConversation(current.conversationId);
      } else if (shouldKickoffAdvancedSection && !repairPrompt) {
        await this.deps.maybeKickoffPostAdvance(conversationId, latestState);
      } else if (shouldKickoffFirstLessonPlanning && !repairPrompt) {
        await this.deps.maybeKickoffFirstLessonPlanning(conversationId, latestState);
      }
    } else {
      await this.deps.refreshConversationCache();
    }
    this.deps.refreshOpenChatLearningControls();
    return { repairPrompt, actionOutcomes, nextSteps: [] };
  }

  private async persistActionOutcomes(
    conversationId: string,
    assistantMessageId: string | undefined,
    outcomes: LearningActionOutcome[],
  ): Promise<void> {
    if (!assistantMessageId || outcomes.length === 0) return;

    const conversation = await this.deps.turns.getConversation(conversationId);
    if (!conversation) return;

    const blocks = learningActionOutcomeBlocks(outcomes);
    const existingBlocks = conversation.uiMessageBlocks?.[assistantMessageId] ?? [];
    const preservedBlocks = existingBlocks.filter((block) => block.type !== 'learning_action_result' && block.type !== 'learning_lesson_plan');
    const uiMessageBlocks: Record<string, MessageUiBlock[]> = {
      ...(conversation.uiMessageBlocks ?? {}),
      [assistantMessageId]: [...preservedBlocks, ...blocks],
    };

    const messages = conversation.messages.map((message) => {
      if (message.id !== assistantMessageId) return message;
      return {
        ...message,
        contentBlocks: [
          ...(message.contentBlocks ?? []).filter(block => block.type !== 'learning_action_result' && block.type !== 'learning_lesson_plan'),
          ...blocks,
        ],
      };
    });

    await this.deps.turns.updateConversation(conversationId, {
      messages,
      uiMessageBlocks,
    });
  }

  private async persistReviewNextStepsIfNeeded(
    conversationId: string,
    assistantMessageId: string | undefined,
    course: CourseState,
    lesson: LessonSession,
  ): Promise<LearningNextStepsContentBlock[]> {
    if (!assistantMessageId || !this.deps.readModel.isReviewLessonReady({ course, lesson })) {
      return [];
    }

    const conversation = await this.deps.turns.getConversation(conversationId);
    if (!conversation || !this.messageHasLearningActivity(conversation, assistantMessageId, 'Preparing chapter review')) {
      return [];
    }

    const block = chapterReviewNextSteps(lesson);
    const existingBlocks = conversation.uiMessageBlocks?.[assistantMessageId] ?? [];
    const preservedBlocks = existingBlocks.filter((candidate) => candidate.type !== 'learning_next_steps');
    const uiMessageBlocks: Record<string, MessageUiBlock[]> = {
      ...(conversation.uiMessageBlocks ?? {}),
      [assistantMessageId]: [...preservedBlocks, block],
    };

    const messages = conversation.messages.map((message) => {
      if (message.id !== assistantMessageId) return message;
      return {
        ...message,
        contentBlocks: [
          ...(message.contentBlocks ?? []).filter(candidate => candidate.type !== 'learning_next_steps'),
          block,
        ],
      };
    });

    await this.deps.turns.updateConversation(conversationId, {
      messages,
      uiMessageBlocks,
    });
    return [block];
  }

  private messageHasLearningActivity(
    conversation: Conversation,
    messageId: string,
    label: string,
  ): boolean {
    const uiBlocks = conversation.uiMessageBlocks?.[messageId] ?? [];
    if (uiBlocks.some((block) => block.type === 'learning_activity' && block.label === label)) {
      return true;
    }

    const message = conversation.messages.find((candidate) => candidate.id === messageId);
    return message?.contentBlocks?.some((block) => block.type === 'learning_activity' && block.label === label) ?? false;
  }
}
