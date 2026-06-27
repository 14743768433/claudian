import type { LearningLessonPlanSource } from '../../../../core/types';
import type { LayoutPort } from '../../ports/LayoutPort';
import type { NoticePort } from '../../ports/NoticePort';
import type { CourseState, LessonSession } from '../../state/types';
import type { LearningActionApplier } from '../LearningActionApplier';
import { SourceLoader, sourcePathFromText } from '../SourceLoader';

export interface LearningNavigationStateService {
  loadCourse(courseId: string): Promise<CourseState | null>;
  currentLesson(course: CourseState): LessonSession | null;
}

export interface NavigationCoordinatorDependencies {
  layout: LayoutPort;
  notice: NoticePort;
  stateService: LearningNavigationStateService;
  stateMachine: LearningActionApplier;
  sourceLoader: SourceLoader;
  cacheCourse(course: CourseState): void;
  ensureLessonConversation(course: CourseState, lesson: LessonSession): Promise<CourseState>;
  openChatConversation(conversationId: string): Promise<void>;
}

export class NavigationCoordinator {
  constructor(private readonly deps: NavigationCoordinatorDependencies) {}

  async openLibrary(): Promise<void> {
    await this.deps.layout.openLibraryTab();
  }

  async enterCourse(courseId: string): Promise<void> {
    const course = await this.deps.stateService.loadCourse(courseId);
    if (!course) {
      this.deps.notice.notify('AI Tutor course state could not be loaded.');
      return;
    }
    this.deps.cacheCourse(course);
    await this.arrangeLearningLayout(course.courseId);
  }

  async enterLesson(courseId: string, lessonId: string): Promise<void> {
    const course = await this.deps.stateService.loadCourse(courseId);
    if (!course) {
      this.deps.notice.notify('AI Tutor course state could not be loaded.');
      return;
    }
    const lesson = course.lessons.find((candidate) => candidate.lessonId === lessonId);
    if (!lesson) {
      this.deps.notice.notify('AI Tutor lesson could not be found.');
      return;
    }
    const ensuredCourse = await this.deps.ensureLessonConversation(course, lesson);
    const result = await this.deps.stateMachine.applyAction(ensuredCourse.courseId, {
      type: 'lessonSelected',
      lessonId,
    });
    if (!result.ok || !result.state) {
      this.deps.notice.notify(result.message ?? 'AI Tutor lesson could not be selected.');
      return;
    }
    const selectedLesson = result.state.lessons.find((candidate) => candidate.lessonId === lessonId) ?? lesson;
    this.deps.cacheCourse(result.state);
    await this.deps.openChatConversation(selectedLesson.conversationId);
    await this.refreshOpenLearningViews(result.state.courseId);
  }

  async arrangeLearningLayout(courseId: string): Promise<void> {
    const course = await this.deps.stateService.loadCourse(courseId);
    if (!course) return;
    const lesson = this.deps.stateService.currentLesson(course);
    if (!lesson) return;

    const ensuredCourse = await this.deps.ensureLessonConversation(course, lesson);
    const ensuredLesson = this.deps.stateService.currentLesson(ensuredCourse) ?? lesson;

    await this.deps.layout.ensureSideLeaves(courseId);
    await this.deps.openChatConversation(ensuredLesson.conversationId);
  }

  async openNote(path: string): Promise<void> {
    try {
      await this.deps.layout.revealNotePane(path);
    } catch {
      this.deps.notice.notify('AI Tutor note file is missing.');
    }
  }

  async openSource(source: string | LearningLessonPlanSource): Promise<void> {
    const label = typeof source === 'string' ? source.trim() : source.label.trim();
    const requestedPath = typeof source === 'string'
      ? sourcePathFromText(label) ?? label
      : source.path?.trim() || sourcePathFromText(source.label) || '';
    const resolvedPath = await this.deps.sourceLoader.resolveSourceVaultPath(requestedPath);
    if (resolvedPath) {
      await this.deps.layout.revealNotePane(resolvedPath);
      return;
    }

    const cardId = typeof source === 'string' ? null : source.cardId;
    if (cardId && !requestedPath) {
      this.deps.notice.notify('This source is an external card, not a vault note yet.');
      return;
    }

    this.deps.notice.notify(`AI Tutor source could not be opened: ${label || requestedPath || 'unknown source'}.`);
  }

  async refreshOpenLearningViews(courseId: string): Promise<void> {
    await this.deps.layout.refreshLearningViews(courseId);
  }

  refreshOpenChatLearningControls(): void {
    this.deps.layout.refreshChatLearningControls();
  }
}
