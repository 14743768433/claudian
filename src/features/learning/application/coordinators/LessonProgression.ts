import type { LearningTurnPort } from '../../ports/LearningTurnPort';
import type { NoticePort } from '../../ports/NoticePort';
import type { LearningActionApplier } from '../LearningActionApplier';
import { SummaryService } from '../SummaryService';
import type { LearningAction, LearningActionResult, LessonSession } from '../../state/types';

export class LessonProgression {
  constructor(
    private readonly turns: Pick<LearningTurnPort, 'createConversation' | 'getConversationSync' | 'renameConversation'>,
    private readonly machine: LearningActionApplier,
    private readonly summaryService: SummaryService,
    private readonly notice: NoticePort = { notify: () => {} },
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
      this.notice.notify(result.state?.machineState === 'chapterEnded'
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
      ? this.turns.getConversationSync(action.conversationId)
      : await this.turns.createConversation();

    if (!conversation) {
      return { ok: false, message: 'Could not create a replacement conversation for the next lesson.' };
    }

    const coveredSummary = action.coveredSummary
      ?? (previousLesson ? await this.summaryService.summarizeLesson(previousLesson) : undefined);

    if (previousLesson && coveredSummary) {
      const summaryResult = await this.machine.applyAction(courseId, {
        type: 'coveredSummaryWritten',
        lessonId: previousLesson.lessonId,
        coveredSummary,
      });
      if (!summaryResult.ok) {
        return summaryResult;
      }
    }

    const result = await this.machine.applyAction(courseId, {
      ...action,
      type: 'startNewLesson',
      conversationId: conversation.id,
      coveredSummary: undefined,
    });

    if (result.ok) {
      const currentLesson = result.state?.lessons.find((lesson) => lesson.lessonId === result.state?.currentLessonId);
      if (currentLesson?.conversationId === conversation.id) {
        await this.turns.renameConversation(conversation.id, `${result.state?.title} 路 ${currentLesson.title}`)
          .catch(() => {});
      }
      this.notice.notify('Started a new AI Tutor lesson.');
    }

    return result;
  }
}
