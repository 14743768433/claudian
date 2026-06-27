import type {
  ChatMessage,
  LearningActivityContentBlock,
  LearningActionResultContentBlock,
  LearningLessonPlanContentBlock,
  LearningNextStepsContentBlock,
} from '../../../core/types';
import type { MessageRenderer } from '../../chat/rendering/MessageRenderer';
import type { LearningService } from '../application/LearningService';

export interface LearningAssistantCompletionInput {
  controller: LearningService | undefined;
  conversationId: string | null;
  assistantMessage: ChatMessage;
  didCancelTurn: boolean;
  finalLearningActivity: LearningActivityContentBlock | null;
  persistMessageUiBlocks: (
    conversationId: string,
    messageId: string,
    blocks: LearningActivityContentBlock[],
  ) => Promise<void>;
  renderer: MessageRenderer;
}

export async function handleLearningAssistantCompletion(
  input: LearningAssistantCompletionInput,
): Promise<string | null> {
  const {
    controller,
    conversationId,
    assistantMessage,
    didCancelTurn,
    finalLearningActivity,
    persistMessageUiBlocks,
    renderer,
  } = input;

  if (conversationId && finalLearningActivity) {
    await persistMessageUiBlocks(conversationId, assistantMessage.id, [finalLearningActivity]);
  }
  if (didCancelTurn || !conversationId || !controller) {
    return null;
  }

  const learningCompletion = await controller.handleAssistantTurnComplete(
    conversationId,
    assistantMessage.content,
    assistantMessage.id,
  );
  const actionBlocks: LearningActionResultContentBlock[] = learningCompletion.actionOutcomes.map((outcome) => ({
    type: 'learning_action_result',
    actionType: outcome.actionType,
    label: outcome.label,
    status: outcome.status,
    detail: outcome.detail,
    message: outcome.message,
    items: outcome.items,
  }));
  const lessonPlanBlocks = learningCompletion.actionOutcomes
    .map((outcome) => outcome.lessonPlan)
    .filter((block): block is LearningLessonPlanContentBlock => !!block);
  const nextStepBlocks: LearningNextStepsContentBlock[] = learningCompletion.nextSteps;

  if (actionBlocks.length > 0 || lessonPlanBlocks.length > 0 || nextStepBlocks.length > 0) {
    assistantMessage.contentBlocks = [
      ...(assistantMessage.contentBlocks ?? []).filter(block => (
        block.type !== 'learning_action_result'
        && block.type !== 'learning_lesson_plan'
        && block.type !== 'learning_next_steps'
      )),
      ...actionBlocks,
      ...lessonPlanBlocks,
      ...nextStepBlocks,
    ];
    if (actionBlocks.length > 0) {
      renderer.appendLearningActionResults(assistantMessage.id, actionBlocks);
    }
    if (lessonPlanBlocks.length > 0) {
      renderer.appendLearningLessonPlans(assistantMessage.id, lessonPlanBlocks);
    }
    if (nextStepBlocks.length > 0) {
      renderer.appendLearningNextSteps(assistantMessage.id, nextStepBlocks);
    }
  }

  return learningCompletion.repairPrompt;
}
