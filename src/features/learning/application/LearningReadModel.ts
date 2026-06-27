import type {
  CourseState,
  LearningTurnMode,
  LoadedLessonRef,
} from '../state/types';

export interface LearningConversationStatus {
  mode: 'Intake' | 'Planning' | 'Teach' | 'Review' | 'Done';
  turnMode: LearningTurnMode;
  courseTitle: string;
  lessonTitle: string;
  chapterLabel: string;
  sectionLabel: string;
  machineState: CourseState['machineState'];
}

export class LearningReadModel {
  constructor(
    private readonly conversationCache: Map<string, LoadedLessonRef>,
    private readonly conversationTurnModes: Map<string, LearningTurnMode>,
  ) {}

  canStartNewLesson(conversationId: string | null): boolean {
    const ref = this.refFor(conversationId);
    return ref ? this.isStartNewLessonReady(ref) : false;
  }

  canAdvanceSection(conversationId: string | null): boolean {
    const ref = this.refFor(conversationId);
    return ref ? this.isAdvanceSectionReady(ref) : false;
  }

  canWriteSectionNote(conversationId: string | null): boolean {
    const ref = this.refFor(conversationId);
    return ref ? this.isWriteSectionNoteReady(ref) : false;
  }

  canPracticeSection(conversationId: string | null): boolean {
    const ref = this.refFor(conversationId);
    return ref ? this.isPracticeSectionReady(ref) : false;
  }

  canReviewLesson(conversationId: string | null): boolean {
    const ref = this.refFor(conversationId);
    return ref ? this.isReviewLessonReady(ref) : false;
  }

  getAdvanceSectionLabel(conversationId: string | null): string | null {
    const ref = this.refFor(conversationId);
    if (!ref || !this.isAdvanceSectionReady(ref)) return null;
    return ref.lesson.currentSectionIndex >= ref.lesson.sections.length - 1
      ? 'Finish chapter'
      : 'Next section';
  }

  getConversationStatus(conversationId: string | null): LearningConversationStatus | null {
    const ref = this.refFor(conversationId);
    if (!ref) return null;

    const { course, lesson } = ref;
    const currentSection = lesson.sections[lesson.currentSectionIndex] ?? null;
    const sectionLabel = currentSection
      ? `${lesson.currentSectionIndex + 1}/${lesson.sections.length} ${currentSection.title}`
      : 'No sections planned';

    return {
      mode: this.statusMode(course.machineState),
      turnMode: this.getConversationTurnMode(conversationId),
      courseTitle: course.title,
      lessonTitle: lesson.title,
      chapterLabel: lesson.kind === 'intake' ? 'Intake' : `Chapter ${lesson.chapterNumber}`,
      sectionLabel,
      machineState: course.machineState,
    };
  }

  setConversationTurnMode(conversationId: string | null, mode: LearningTurnMode): boolean {
    if (!conversationId || !this.conversationCache.has(conversationId)) {
      return false;
    }
    this.conversationTurnModes.set(conversationId, mode);
    return true;
  }

  getConversationTurnMode(conversationId: string | null): LearningTurnMode {
    if (!conversationId) return 'teach';
    return this.conversationTurnModes.get(conversationId) ?? 'teach';
  }

  isStartNewLessonReady(ref: LoadedLessonRef): boolean {
    const { course, lesson } = ref;
    return course.currentLessonId === lesson.lessonId
      && course.machineState === 'chapterEnded'
      && lesson.kind === 'lesson'
      && lesson.status === 'ended'
      && lesson.sections.length > 0
      && lesson.sections.every((section) => section.status === 'covered');
  }

  isAdvanceSectionReady(ref: LoadedLessonRef): boolean {
    const { course, lesson } = ref;
    const section = lesson.sections[lesson.currentSectionIndex] ?? null;
    return course.currentLessonId === lesson.lessonId
      && course.machineState === 'teaching'
      && lesson.kind === 'lesson'
      && lesson.status === 'active'
      && section?.status === 'noteWritten';
  }

  isWriteSectionNoteReady(ref: LoadedLessonRef): boolean {
    const { course, lesson } = ref;
    const section = lesson.sections[lesson.currentSectionIndex] ?? null;
    return course.currentLessonId === lesson.lessonId
      && course.machineState === 'teaching'
      && lesson.kind === 'lesson'
      && lesson.status === 'active'
      && section?.status === 'pending';
  }

  isPracticeSectionReady(ref: LoadedLessonRef): boolean {
    const { course, lesson } = ref;
    const section = lesson.sections[lesson.currentSectionIndex] ?? null;
    return course.currentLessonId === lesson.lessonId
      && course.machineState === 'teaching'
      && lesson.kind === 'lesson'
      && lesson.status === 'active'
      && !!section
      && (section.status === 'pending' || section.status === 'noteWritten');
  }

  isReviewLessonReady(ref: LoadedLessonRef): boolean {
    const { course, lesson } = ref;
    return course.currentLessonId === lesson.lessonId
      && course.machineState === 'chapterEnded'
      && lesson.kind === 'lesson'
      && lesson.status === 'ended'
      && lesson.sections.length > 0;
  }

  isCurrentLessonWaitingForKickoff(ref: LoadedLessonRef): boolean {
    const { course, lesson } = ref;
    return course.currentLessonId === lesson.lessonId
      && lesson.kind === 'lesson'
      && lesson.status === 'active'
      && (course.machineState === 'chapterPlanning' || course.machineState === 'teaching');
  }

  private refFor(conversationId: string | null): LoadedLessonRef | null {
    if (!conversationId) return null;
    return this.conversationCache.get(conversationId) ?? null;
  }

  private statusMode(machineState: CourseState['machineState']): LearningConversationStatus['mode'] {
    switch (machineState) {
      case 'intake':
        return 'Intake';
      case 'chapterPlanning':
        return 'Planning';
      case 'teaching':
        return 'Teach';
      case 'chapterEnded':
        return 'Review';
      case 'completed':
        return 'Done';
      default:
        return 'Teach';
    }
  }
}
