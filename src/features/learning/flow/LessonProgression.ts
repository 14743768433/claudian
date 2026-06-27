import { Notice } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { LearningStateMachine } from './LearningStateMachine';
import { SummaryService } from './SummaryService';
import type { LearningAction, LearningActionResult, LessonSession } from '../state/types';

export class LessonProgression {
  constructor(
    private readonly plugin: ClaudianPlugin,
    private readonly machine: LearningStateMachine,
    private readonly summaryService: SummaryService,
  ) {}

  async applyAssistantAction(courseId: string, action: LearningAction): Promise<LearningActionResult> {
    if (action.type !== 'startNewLesson') {
      return this.machine.applyAction(courseId, action);
    }

    return this.startNewLesson(courseId, action);
  }

  async advanceSection(
    courseId: string,
    action: Extract<LearningAction, { type: 'advanceSection' }> = { type: 'advanceSection' },
  ): Promise<LearningActionResult> {
    const result = await this.machine.applyAction(courseId, action);
    if (result.ok) {
      new Notice(result.state?.machineState === 'chapterEnded'
        ? 'AI Tutor finished this chapter.'
        : 'AI Tutor continued to the next section.');
    }
    return result;
  }

  async startNewLesson(
    courseId: string,
    action: Extract<LearningAction, { type: 'startNewLesson' }>,
    previousLesson?: LessonSession | null,
  ): Promise<LearningActionResult> {
    const conversation = action.conversationId
      ? this.plugin.getConversationSync(action.conversationId)
      : await this.plugin.createConversation();

    if (!conversation) {
      return { ok: false, message: 'Could not create a replacement conversation for the next lesson.' };
    }

    const coveredSummary = action.coveredSummary
      ?? (previousLesson ? await this.summaryService.summarizeLesson(previousLesson) : undefined);

    const result = await this.machine.applyAction(courseId, {
      ...action,
      type: 'startNewLesson',
      conversationId: conversation.id,
      coveredSummary,
    });

    if (result.ok) {
      const currentLesson = result.state?.lessons.find((lesson) => lesson.lessonId === result.state?.currentLessonId);
      if (currentLesson?.conversationId === conversation.id) {
        const plugin = this.plugin as ClaudianPlugin & {
          renameConversation?: (id: string, title: string) => Promise<void>;
        };
        await plugin.renameConversation?.(conversation.id, `${result.state?.title} · ${currentLesson.title}`)
          .catch(() => {});
      }
      new Notice('Started a new AI Tutor lesson.');
    }

    return result;
  }
}
