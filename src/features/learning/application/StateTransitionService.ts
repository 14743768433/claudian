import { LearningStateMachine } from '../domain/LearningStateMachine';
import type { CourseState, LearningAction, LearningActionResult } from '../domain/types';
import type { StatePort } from '../ports/StatePort';

type StateTransitionPort = Pick<StatePort, 'loadCourse' | 'saveCourse'>;

export class StateTransitionService {
  constructor(
    private readonly statePort: StateTransitionPort,
    private readonly machine = new LearningStateMachine(),
  ) {}

  async applyAction(courseId: string, action: LearningAction): Promise<LearningActionResult> {
    const state = await this.statePort.loadCourse(courseId);
    if (!state) {
      return { ok: false, message: 'Course state could not be loaded.' };
    }

    return this.applyToLoadedState(state, action);
  }

  async applyToLoadedState(state: CourseState, action: LearningAction): Promise<LearningActionResult> {
    const transition = this.machine.reduce(state, action);
    if (!transition.ok || !transition.nextState) {
      return { ok: false, message: transition.message };
    }

    await this.statePort.saveCourse(transition.nextState);
    Object.assign(state, transition.nextState);
    return { ok: true, state };
  }
}
