import type {
  CourseState,
  LearningAction,
  LearningActionResult,
  LessonSession,
  Section,
  SyllabusTopic,
} from './types';

export interface LearningStateTransition {
  ok: boolean;
  nextState?: CourseState;
  message?: string;
  effects: LearningStateEffect[];
}

export type LearningStateEffect =
  | { type: 'courseStateChanged'; courseId: string };

function cloneCourseState(state: CourseState): CourseState {
  return JSON.parse(JSON.stringify(state)) as CourseState;
}

function slugId(prefix: string, value: string, index: number): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${prefix}-${slug || index + 1}`;
}

function activeLesson(state: CourseState): LessonSession | null {
  return state.lessons.find((lesson) => lesson.lessonId === state.currentLessonId) ?? null;
}

function toSections(raw: Array<{ id?: string; title: string }>): Section[] {
  return raw
    .map((section, index) => ({
      id: section.id?.trim() || slugId('section', section.title, index),
      title: section.title.trim(),
      status: 'pending' as const,
    }))
    .filter((section) => section.title.length > 0);
}

export class LearningStateMachine {
  reduce(state: CourseState, action: LearningAction): LearningStateTransition {
    const nextState = cloneCourseState(state);
    const result = this.applyMutable(nextState, action);
    if (!result.ok) {
      return { ok: false, message: result.message, effects: [] };
    }
    return {
      ok: true,
      nextState,
      effects: [{ type: 'courseStateChanged', courseId: nextState.courseId }],
    };
  }

  applyToState(state: CourseState, action: LearningAction): LearningActionResult {
    const transition = this.reduce(state, action);
    if (!transition.ok || !transition.nextState) {
      return { ok: false, message: transition.message };
    }
    return { ok: true, state: transition.nextState };
  }

  private applyMutable(state: CourseState, action: LearningAction): LearningActionResult {
    switch (action.type) {
      case 'generateSyllabus':
        return this.generateSyllabus(state, action);
      case 'planChapter':
        return this.planChapter(state, action);
      case 'sectionNoteWritten':
        return this.sectionNoteWritten(state, action);
      case 'advanceSection':
        return this.advanceSection(state, action);
      case 'startNewLesson':
        return this.startNewLesson(state, action);
      default:
        return { ok: false, message: 'Unknown AI Tutor action.' };
    }
  }

  private generateSyllabus(
    state: CourseState,
    action: Extract<LearningAction, { type: 'generateSyllabus' }>,
  ): LearningActionResult {
    if (action.topics.length === 0) {
      return { ok: false, message: 'Syllabus must contain at least one topic.' };
    }
    const topics: SyllabusTopic[] = action.topics
      .map((topic, index) => ({
        id: topic.id?.trim() || slugId('topic', topic.title, index),
        title: topic.title.trim(),
        order: index + 1,
        sourcePaths: topic.sourcePaths,
        summary: topic.summary,
      }))
      .filter((topic) => topic.title.length > 0);

    if (topics.length === 0) {
      return { ok: false, message: 'Syllabus topics must have titles.' };
    }

    state.syllabus = topics;
    state.machineState = 'chapterPlanning';
    return { ok: true, state };
  }

  private planChapter(
    state: CourseState,
    action: Extract<LearningAction, { type: 'planChapter' }>,
  ): LearningActionResult {
    const sections = toSections(action.sections);
    if (sections.length === 0) {
      return { ok: false, message: 'A chapter plan needs at least one section.' };
    }

    const current = activeLesson(state);
    if (!current) {
      return { ok: false, message: 'No current lesson is active.' };
    }

    if (current.kind === 'intake') {
      const chapterNumber = action.chapterNumber ?? 1;
      const lessonId = action.lessonId ?? `lesson-${chapterNumber}`;
      const now = Date.now();
      const lesson: LessonSession = {
        lessonId,
        kind: 'lesson',
        chapterNumber,
        title: action.title.trim() || `Chapter ${chapterNumber}`,
        conversationId: action.conversationId ?? current.conversationId,
        status: 'active',
        sections,
        currentSectionIndex: 0,
        previousLessonId: current.lessonId,
        createdAt: now,
        updatedAt: now,
      };
      state.lessons.push(lesson);
      state.currentLessonId = lesson.lessonId;
      current.status = 'ended';
      current.updatedAt = now;
      state.machineState = 'teaching';
      return { ok: true, state };
    }

    if (current.status === 'ended') {
      return { ok: false, message: 'Cannot re-plan an ended chapter.' };
    }

    current.title = action.title.trim() || current.title;
    current.sections = sections;
    current.currentSectionIndex = 0;
    current.status = 'active';
    current.updatedAt = Date.now();
    state.machineState = 'teaching';
    return { ok: true, state };
  }

  private sectionNoteWritten(
    state: CourseState,
    action: Extract<LearningAction, { type: 'sectionNoteWritten' }>,
  ): LearningActionResult {
    const lesson = activeLesson(state);
    if (!lesson || lesson.kind !== 'lesson') {
      return { ok: false, message: 'No teachable lesson is active.' };
    }

    const section = this.resolveSection(lesson, action.sectionId);
    if (!section) {
      return { ok: false, message: 'Section not found.' };
    }
    if (section.status === 'covered') {
      return { ok: false, message: 'Covered sections cannot be rewritten by action.' };
    }

    section.status = 'noteWritten';
    section.notePath = action.notePath;
    section.noteTitle = action.noteTitle ?? section.noteTitle ?? section.title;
    section.missing = false;
    lesson.updatedAt = Date.now();
    state.machineState = 'teaching';
    return { ok: true, state };
  }

  private advanceSection(
    state: CourseState,
    action: Extract<LearningAction, { type: 'advanceSection' }>,
  ): LearningActionResult {
    const lesson = activeLesson(state);
    if (!lesson || lesson.kind !== 'lesson') {
      return { ok: false, message: 'No teachable lesson is active.' };
    }

    const section = this.resolveSection(lesson, action.sectionId);
    if (!section) {
      return { ok: false, message: 'Section not found.' };
    }
    if (section.status !== 'noteWritten') {
      return { ok: false, message: 'Current section note must be written before advancing.' };
    }

    const index = lesson.sections.findIndex((candidate) => candidate.id === section.id);
    section.status = 'covered';
    if (index < lesson.sections.length - 1) {
      lesson.currentSectionIndex = index + 1;
      state.machineState = 'teaching';
    } else {
      lesson.currentSectionIndex = index;
      lesson.status = 'ended';
      state.machineState = 'chapterEnded';
    }
    lesson.updatedAt = Date.now();
    return { ok: true, state };
  }

  private startNewLesson(
    state: CourseState,
    action: Extract<LearningAction, { type: 'startNewLesson' }>,
  ): LearningActionResult {
    if (!action.conversationId) {
      return { ok: false, message: 'A new lesson requires a conversation id.' };
    }

    const previous = activeLesson(state);
    if (!previous) {
      return { ok: false, message: 'No active lesson to close.' };
    }
    if (
      previous.kind === 'lesson'
      && !action.force
      && previous.sections.some((section) => section.status !== 'covered')
    ) {
      return { ok: false, message: 'All sections must be covered before starting a new lesson.' };
    }

    const now = Date.now();
    previous.status = 'ended';
    previous.coveredSummary = action.coveredSummary ?? previous.coveredSummary;
    previous.updatedAt = now;

    const chapterNumber = Math.max(0, ...state.lessons.map((lesson) => lesson.chapterNumber)) + 1;
    const lesson: LessonSession = {
      lessonId: `lesson-${chapterNumber}`,
      kind: 'lesson',
      chapterNumber,
      title: action.title?.trim() || `Chapter ${chapterNumber}`,
      conversationId: action.conversationId,
      status: 'active',
      sections: toSections(action.sections ?? []),
      currentSectionIndex: 0,
      previousLessonId: previous.lessonId,
      createdAt: now,
      updatedAt: now,
    };

    state.lessons.push(lesson);
    state.currentLessonId = lesson.lessonId;
    state.machineState = lesson.sections.length > 0 ? 'teaching' : 'chapterPlanning';
    return { ok: true, state };
  }

  private resolveSection(lesson: LessonSession, sectionId?: string): Section | null {
    if (sectionId) {
      return lesson.sections.find((section) => section.id === sectionId) ?? null;
    }
    return lesson.sections[lesson.currentSectionIndex] ?? null;
  }
}
