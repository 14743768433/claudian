import type { LearningAction, LearningActionResult } from '../domain/types';

export interface LearningActionApplier {
  applyAction(courseId: string, action: LearningAction): Promise<LearningActionResult>;
}
