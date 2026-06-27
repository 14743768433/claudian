export const LEARNING_SCHEMA_VERSION = 1;
export const COURSE_STATE_DIR = '.ai-tutor';
export const COURSE_STATE_FILE = `${COURSE_STATE_DIR}/course-state.json`;

export type CourseMachineState =
  | 'intake'
  | 'chapterPlanning'
  | 'teaching'
  | 'chapterEnded'
  | 'completed';

export type LessonKind = 'intake' | 'lesson';
export type LessonStatus = 'planned' | 'active' | 'ended';
export type SectionStatus = 'pending' | 'noteWritten' | 'covered';
export type LearningTurnMode = 'teach' | 'ask' | 'transform';

export interface SyllabusTopic {
  id: string;
  title: string;
  order: number;
  sourcePaths?: string[];
  summary?: string;
}

export interface Section {
  id: string;
  title: string;
  status: SectionStatus;
  notePath?: string;
  noteTitle?: string;
  missing?: boolean;
}

export interface LessonSession {
  lessonId: string;
  kind: LessonKind;
  chapterNumber: number;
  title: string;
  conversationId: string;
  status: LessonStatus;
  sections: Section[];
  currentSectionIndex: number;
  coveredSummary?: string;
  previousLessonId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CourseState {
  schemaVersion: typeof LEARNING_SCHEMA_VERSION;
  courseId: string;
  title: string;
  goalTitle: string;
  rootPath: string;
  currentLessonId: string;
  machineState: CourseMachineState;
  syllabus: SyllabusTopic[];
  lessons: LessonSession[];
  createdAt: number;
  updatedAt: number;
}

export interface CourseIndexEntry {
  courseId: string;
  title: string;
  goalTitle: string;
  rootPath: string;
  currentLessonId: string;
  updatedAt: number;
}

export interface LearningPluginData {
  learning?: {
    courses?: CourseIndexEntry[];
  };
}

export interface CreateCourseInput {
  title: string;
  goalTitle: string;
  rootPath?: string;
  intakeConversationId: string;
  now?: number;
}

export interface LearningPlanSourceRef {
  text?: string;
  cardId?: string;
  path?: string;
}

export interface LearningPlanSectionInput {
  id?: string;
  title: string;
  description?: string;
  bulletPoints?: string[];
  sources?: Array<string | LearningPlanSourceRef>;
}

export interface LoadedLessonRef {
  course: CourseState;
  lesson: LessonSession;
}

export type LearningAction =
  | {
      type: 'generateSyllabus';
      topics: Array<{
        id?: string;
        title: string;
        sourcePaths?: string[];
        summary?: string;
      }>;
    }
  | {
      type: 'planChapter';
      title: string;
      overview?: string;
      sections: LearningPlanSectionInput[];
      nextLessonSummary?: string;
      lessonId?: string;
      chapterNumber?: number;
      conversationId?: string;
    }
  | {
      type: 'sectionNoteWritten';
      sectionId?: string;
      notePath: string;
      noteTitle?: string;
    }
  | {
      type: 'advanceSection';
      sectionId?: string;
    }
  | {
      type: 'startNewLesson';
      title?: string;
      conversationId?: string;
      coveredSummary?: string;
      sections?: LearningPlanSectionInput[];
      force?: boolean;
    };

export interface LearningActionResult {
  ok: boolean;
  state?: CourseState;
  message?: string;
}
