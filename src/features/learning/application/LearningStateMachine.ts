import { LearningStateMachine as DomainLearningStateMachine } from '../domain/LearningStateMachine';
import type { IndexRepository } from '../application/IndexRepository';
import { StateTransitionService } from '../application/StateTransitionService';
import type { CourseState, LearningAction, LearningActionResult } from '../domain/types';
import type { StatePort } from '../ports/StatePort';

export class LearningStateMachine {
  private readonly domainMachine = new DomainLearningStateMachine();
  private readonly transitionService: StateTransitionService;

  constructor(
    stateService: Pick<StatePort, 'loadCourse' | 'saveCourse'>,
    indexRepository: IndexRepository | null = null,
  ) {
    this.transitionService = new StateTransitionService(stateService, indexRepository);
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
