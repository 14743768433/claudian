import { LearningStateMachine } from '../domain/LearningStateMachine';
import type { CourseState, CreateCourseInput, LearningAction, LearningActionResult } from '../domain/types';
import type { StatePort } from '../ports/StatePort';
import { IndexRepository } from './IndexRepository';

type StateTransitionPort = Pick<StatePort, 'loadCourse' | 'saveCourse'>;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class StateTransitionService {
  constructor(
    private readonly statePort: StateTransitionPort,
    private readonly indexRepository: IndexRepository | null = null,
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

    await this.persistCourse(transition.nextState);
    Object.assign(state, transition.nextState);
    return { ok: true, state };
  }

  async createCourse(input: CreateCourseInput): Promise<LearningActionResult> {
    const now = input.now ?? Date.now();
    const transition = this.machine.createCourse({
      type: 'courseCreated',
      courseId: input.courseId ?? createId('course'),
      title: input.title,
      goalTitle: input.goalTitle,
      rootPath: input.rootPath,
      intakeConversationId: input.intakeConversationId,
      now,
    });
    if (!transition.ok || !transition.nextState) {
      return { ok: false, message: transition.message };
    }

    await this.persistCourse(transition.nextState, { preserveUpdatedAt: true });
    return { ok: true, state: transition.nextState };
  }

  private async persistCourse(state: CourseState, options?: { preserveUpdatedAt?: boolean }): Promise<void> {
    await this.statePort.saveCourse(state, options);
    await this.indexRepository?.refreshFromCourseState(state);
  }
}
