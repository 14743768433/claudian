import type { LearningAction, LearningActionResult } from '../state/types';

export interface LearningActionApplier {
  applyAction(courseId: string, action: LearningAction): Promise<LearningActionResult>;
}
