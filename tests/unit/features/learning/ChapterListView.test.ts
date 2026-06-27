import { createMockEl } from '@test/helpers/mockElement';

import { ChapterListView } from '@/features/learning/views/ChapterListView';
import type { CourseState } from '@/features/learning/state/types';

function makeCourse(input: {
  courseId: string;
  goalTitle: string;
  title: string;
  currentLessonId: string;
  lessonTitle: string;
}): CourseState {
  return {
    schemaVersion: 1,
    courseId: input.courseId,
    title: input.title,
    goalTitle: input.goalTitle,
    rootPath: `AI Tutor/Courses/${input.courseId}`,
    currentLessonId: input.currentLessonId,
    machineState: 'teaching',
    syllabus: [],
    lessons: [{
      lessonId: input.currentLessonId,
      kind: 'lesson',
      chapterNumber: 1,
      title: input.lessonTitle,
      conversationId: `${input.courseId}-conv-1`,
      status: 'active',
      sections: [],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createView(plugin: any, contentEl = createMockEl()) {
  const view = new ChapterListView({} as any, plugin);
  (view as any).contentEl = contentEl;
  return { view, contentEl };
}

describe('ChapterListView', () => {
  it('renders only the active course instead of every indexed course', async () => {
    const runningCourse = makeCourse({
      courseId: 'running',
      goalTitle: '提高跑步水平，减肥',
      title: '学习跑步',
      currentLessonId: 'running-lesson-1',
      lessonTitle: 'Running base',
    });
    const readingCourse = makeCourse({
      courseId: 'reading',
      goalTitle: '我想学一下如何阅读一本书',
      title: '如何阅读一本书',
      currentLessonId: 'reading-lesson-1',
      lessonTitle: 'Reading intake',
    });
    const plugin = {
      learningController: {
        listCourseEntries: jest.fn(async () => [
          {
            courseId: runningCourse.courseId,
            title: runningCourse.title,
            goalTitle: runningCourse.goalTitle,
            rootPath: runningCourse.rootPath,
            currentLessonId: runningCourse.currentLessonId,
            updatedAt: 1,
          },
          {
            courseId: readingCourse.courseId,
            title: readingCourse.title,
            goalTitle: readingCourse.goalTitle,
            rootPath: readingCourse.rootPath,
            currentLessonId: readingCourse.currentLessonId,
            updatedAt: 2,
          },
        ]),
        loadCourse: jest.fn(async (courseId: string) => (
          courseId === readingCourse.courseId ? readingCourse : runningCourse
        )),
        loadCurrentCourse: jest.fn(async () => runningCourse),
        enterLesson: jest.fn(),
      },
    };
    const { view, contentEl } = createView(plugin);
    (view as any).courseId = readingCourse.courseId;

    await view.render();

    expect(plugin.learningController.listCourseEntries).not.toHaveBeenCalled();
    expect(plugin.learningController.loadCourse).toHaveBeenCalledWith('reading');
    expect(contentEl.children[0]?.textContent).toBe('我想学一下如何阅读一本书');
    expect(contentEl.querySelector('.ai-tutor-course-heading-title')?.textContent).toBe('如何阅读一本书');
    expect(contentEl.querySelectorAll('.ai-tutor-course-heading-title')).toHaveLength(1);
    expect(contentEl.querySelectorAll('.ai-tutor-chapter-item')).toHaveLength(1);
  });

  it('falls back to the current course before a course id is assigned', async () => {
    const currentCourse = makeCourse({
      courseId: 'reading',
      goalTitle: '我想学一下如何阅读一本书',
      title: '如何阅读一本书',
      currentLessonId: 'reading-lesson-1',
      lessonTitle: 'Reading intake',
    });
    const plugin = {
      learningController: {
        loadCourse: jest.fn(),
        loadCurrentCourse: jest.fn(async () => currentCourse),
        enterLesson: jest.fn(),
      },
    };
    const { view, contentEl } = createView(plugin);

    await view.render();

    expect(plugin.learningController.loadCurrentCourse).toHaveBeenCalled();
    expect(contentEl.querySelector('.ai-tutor-course-heading-title')?.textContent).toBe('如何阅读一本书');
  });
});
