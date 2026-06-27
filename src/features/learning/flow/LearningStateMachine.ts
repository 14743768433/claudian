import { LearningStateMachine as DomainLearningStateMachine } from '../domain/LearningStateMachine';
import { StateTransitionService } from '../application/StateTransitionService';
import type { LearningStateService } from '../state/LearningStateService';
import type { CourseState, LearningAction, LearningActionResult } from '../state/types';

export class LearningStateMachine {
  private readonly domainMachine = new DomainLearningStateMachine();
  private readonly transitionService: StateTransitionService;

  constructor(private readonly stateService: LearningStateService) {
    this.transitionService = new StateTransitionService(stateService);
  }

  async applyAction(courseId: string, action: LearningAction): Promise<LearningActionResult> {
    return this.transitionService.applyAction(courseId, action);
  }

  applyToState(state: CourseState, action: LearningAction): LearningActionResult {
    const result = this.domainMachine.applyToState(state, action);
    if (!result.ok || !result.state) {
      return result;
    }
    Object.assign(state, result.state);
    return { ok: true, state };
  }
}
