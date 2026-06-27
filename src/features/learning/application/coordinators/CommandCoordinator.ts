import type { LoadedLessonRef } from '../../state/types';

export interface LearningCommandCourseLookup {
  findByConversationId(conversationId: string): Promise<LoadedLessonRef | null>;
}

export interface LearningCommandReadModel {
  isCurrentLessonWaitingForKickoff(ref: LoadedLessonRef): boolean;
}

export interface LearningCommandActions {
  advanceSectionFromConversation(conversationId: string): Promise<void>;
  writeSectionNoteFromConversation(conversationId: string): Promise<void>;
  practiceSectionFromConversation(conversationId: string): Promise<void>;
  reviewLessonFromConversation(conversationId: string): Promise<void>;
  startNewLessonFromConversation(conversationId: string, options?: { force?: boolean }): Promise<void>;
  openChatConversation(conversationId: string): Promise<void>;
}

export interface CommandCoordinatorDependencies {
  courseLookup: LearningCommandCourseLookup;
  readModel: LearningCommandReadModel;
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
      await this.deps.actions.advanceSectionFromConversation(conversationId);
      return true;
    }

    if (isWriteSectionNoteCommand(text)) {
      await this.deps.actions.writeSectionNoteFromConversation(conversationId);
      return true;
    }

    if (isPracticeSectionCommand(text)) {
      await this.deps.actions.practiceSectionFromConversation(conversationId);
      return true;
    }

    if (isReviewLessonCommand(text)) {
      await this.deps.actions.reviewLessonFromConversation(conversationId);
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
      await this.deps.actions.startNewLessonFromConversation(conversationId, { force: true });
      return true;
    }

    return false;
  }
}
