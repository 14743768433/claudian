import type { NoticePort } from '../../ports/NoticePort';
import type { CourseState, LessonSession, LoadedLessonRef } from '../../state/types';
import type { LessonProgression } from './LessonProgression';

export interface LearningCommandCourseLookup {
  findByConversationId(conversationId: string): Promise<LoadedLessonRef | null>;
  currentLesson(course: CourseState): LessonSession | null;
}

export interface LearningCommandReadModel {
  isCurrentLessonWaitingForKickoff(ref: LoadedLessonRef): boolean;
  isWriteSectionNoteReady(ref: LoadedLessonRef): boolean;
  isPracticeSectionReady(ref: LoadedLessonRef): boolean;
  isReviewLessonReady(ref: LoadedLessonRef): boolean;
  isStartNewLessonReady(ref: LoadedLessonRef): boolean;
}

export interface LearningCommandActions {
  cacheCourse(course: CourseState): void;
  refreshOpenLearningViews(courseId: string): Promise<void>;
  refreshOpenChatLearningControls(): void;
  maybeKickoffPostAdvance(conversationId: string, state: CourseState): Promise<void>;
  openChatConversation(conversationId: string): Promise<void>;
  sendSectionNoteTurn(conversationId: string, ref: LoadedLessonRef): Promise<boolean>;
  sendSectionPracticeTurn(conversationId: string, ref: LoadedLessonRef): Promise<boolean>;
  sendLessonReviewTurn(conversationId: string, course: CourseState, lesson: LessonSession): Promise<boolean>;
}

export interface CommandCoordinatorDependencies {
  courseLookup: LearningCommandCourseLookup;
  readModel: LearningCommandReadModel;
  progression: LessonProgression;
  notice: NoticePort;
  actions: LearningCommandActions;
  hasAssistantResponse(conversationId: string): Promise<boolean>;
}

function isStartNewLessonCommand(text: string): boolean {
  return /^\s*(?:请\s*)?(?:(?:开始|开启|进入|继续(?:到)?)\s*)?(?:下(?:一)?章|下(?:一)?课|新(?:一)?章|新(?:一)?课|start\s+new\s+lesson|next\s+chapter|next\s+lesson)\s*[。.!！?？]*\s*$/i.test(text);
}

function isAdvanceSectionCommand(text: string): boolean {
  return /^\s*(?:请\s*)?(?:(?:(?:开始|开启|进入|继续(?:到)?|跳到)\s*)?(?:下(?:一)?节|下(?:一)?小节|新(?:一)?节|新(?:一)?小节|next\s+section|next\s+part)|(?:完成|结束)\s*(?:本章|当前章|这一章|这章)|(?:finish|end)\s+(?:this\s+)?chapter)\s*[。.!！?？]*\s*$/i.test(text);
}

function isWriteSectionNoteCommand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return /^(?:请|帮我|麻烦你)?\s*(?:(?:生成|写|撰写|创建|输出)\s*(?:本节|当前(?:小节|章节)?|这一节|第\s*\d+\s*节)?\s*(?:节笔记|小节笔记|笔记|lesson\s+note|lesson\s+page)|(?:write|generate|create|draft)\s+(?:this\s+)?(?:section|lesson)\s+(?:note|page))\s*[。.!！?？]*\s*$/i.test(trimmed);
}

function isPracticeSectionCommand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return /^(?:请|帮我|麻烦你)?\s*(?:(?:做|来|生成|出|给我|安排)?\s*(?:一个|一下|本节|当前(?:小节|章节)?|这一节)?\s*(?:小测|测验|测试|练习|检查题|自测|quiz|practice|checkpoint)|(?:quiz|practice|check)\s*(?:me|this\s+section|this\s+lesson)?)\s*[。.!！?？]*\s*$/i.test(trimmed);
}

function isReviewLessonCommand(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return /^(?:请|帮我|麻烦你)?\s*(?:(?:复盘|回顾|总结|整理)\s*(?:本章|当前章|这一章|这章|本课|当前课|这一课)?|(?:review|summarize)\s+(?:this\s+)?(?:chapter|lesson))\s*[。.!！?？]*\s*$/i.test(trimmed);
}

export class CommandCoordinator {
  constructor(private readonly deps: CommandCoordinatorDependencies) {}

  async handleUserCommand(conversationId: string | null, text: string): Promise<boolean> {
    if (!conversationId) {
      return false;
    }

    const ref = await this.deps.courseLookup.findByConversationId(conversationId);
    if (!ref) {
      return false;
    }

    if (isAdvanceSectionCommand(text)) {
      await this.advanceSectionFromConversation(conversationId);
      return true;
    }

    if (isWriteSectionNoteCommand(text)) {
      await this.writeSectionNoteFromConversation(conversationId);
      return true;
    }

    if (isPracticeSectionCommand(text)) {
      await this.practiceSectionFromConversation(conversationId);
      return true;
    }

    if (isReviewLessonCommand(text)) {
      await this.reviewLessonFromConversation(conversationId);
      return true;
    }

    if (isStartNewLessonCommand(text)) {
      if (
        this.deps.readModel.isCurrentLessonWaitingForKickoff(ref)
        && !(await this.deps.hasAssistantResponse(ref.lesson.conversationId))
      ) {
        await this.deps.actions.openChatConversation(ref.lesson.conversationId);
        return true;
      }
      await this.startNewLessonFromConversation(conversationId, { force: true });
      return true;
    }

    return false;
  }

  async advanceSectionFromConversation(conversationId: string): Promise<void> {
    const ref = await this.requireRef(conversationId);
    if (!ref) return;

    const result = await this.deps.progression.advanceSection(ref.course.courseId);
    if (!result.ok || !result.state) {
      this.deps.notice.notify(result.message ?? 'AI Tutor could not continue to the next section.');
      this.deps.actions.refreshOpenChatLearningControls();
      return;
    }

    this.deps.actions.cacheCourse(result.state);
    await this.deps.actions.refreshOpenLearningViews(result.state.courseId);
    this.deps.actions.refreshOpenChatLearningControls();
    await this.deps.actions.maybeKickoffPostAdvance(conversationId, result.state);
  }

  async writeSectionNoteFromConversation(conversationId: string): Promise<void> {
    const ref = await this.requireRef(conversationId);
    if (!ref) return;

    if (!this.deps.readModel.isWriteSectionNoteReady(ref)) {
      this.deps.notice.notify('AI Tutor can only write a note for the current pending section.');
      this.deps.actions.refreshOpenChatLearningControls();
      return;
    }

    if (!await this.deps.actions.sendSectionNoteTurn(conversationId, ref)) {
      this.deps.notice.notify('AI Tutor is already working. Try writing the note after the current turn finishes.');
      this.deps.actions.refreshOpenChatLearningControls();
    }
  }

  async practiceSectionFromConversation(conversationId: string): Promise<void> {
    const ref = await this.requireRef(conversationId);
    if (!ref) return;

    if (!this.deps.readModel.isPracticeSectionReady(ref)) {
      this.deps.notice.notify('AI Tutor can only practice the current active section.');
      this.deps.actions.refreshOpenChatLearningControls();
      return;
    }

    if (!await this.deps.actions.sendSectionPracticeTurn(conversationId, ref)) {
      this.deps.notice.notify('AI Tutor is already working. Try the practice check after the current turn finishes.');
      this.deps.actions.refreshOpenChatLearningControls();
    }
  }

  async reviewLessonFromConversation(conversationId: string): Promise<void> {
    const ref = await this.requireRef(conversationId);
    if (!ref) return;

    if (!this.deps.readModel.isReviewLessonReady(ref)) {
      this.deps.notice.notify('AI Tutor can only review a chapter after it is finished.');
      this.deps.actions.refreshOpenChatLearningControls();
      return;
    }

    if (!await this.deps.actions.sendLessonReviewTurn(conversationId, ref.course, ref.lesson)) {
      this.deps.notice.notify('AI Tutor is already working. Try the chapter review after the current turn finishes.');
      this.deps.actions.refreshOpenChatLearningControls();
    }
  }

  async startNewLessonFromConversation(
    conversationId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const ref = await this.requireRef(conversationId);
    if (!ref) return;

    if (!options.force && !this.deps.readModel.isStartNewLessonReady(ref)) {
      this.deps.notice.notify('Finish and cover every section before starting a new lesson.');
      this.deps.actions.refreshOpenChatLearningControls();
      return;
    }

    const result = await this.deps.progression.startNewLesson(
      ref.course.courseId,
      options.force === true
        ? { type: 'startNewLesson', force: true }
        : { type: 'startNewLesson' },
      ref.lesson,
    );

    if (!result.ok || !result.state) {
      this.deps.notice.notify(result.message ?? 'AI Tutor could not start a new lesson.');
      this.deps.actions.refreshOpenChatLearningControls();
      return;
    }

    this.deps.actions.cacheCourse(result.state);
    await this.deps.actions.refreshOpenLearningViews(result.state.courseId);
    const current = this.deps.courseLookup.currentLesson(result.state);
    if (current) {
      await this.deps.actions.openChatConversation(current.conversationId);
    } else {
      this.deps.actions.refreshOpenChatLearningControls();
    }
  }

  private async requireRef(conversationId: string): Promise<LoadedLessonRef | null> {
    const ref = await this.deps.courseLookup.findByConversationId(conversationId);
    if (!ref) {
      this.deps.notice.notify('AI Tutor could not find a course for this conversation.');
      this.deps.actions.refreshOpenChatLearningControls();
      return null;
    }
    this.deps.actions.cacheCourse(ref.course);
    return ref;
  }
}
