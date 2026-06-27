import { createMockEl } from '@test/helpers/mockElement';
import { MarkdownRenderer } from 'obsidian';

import type { LearningLessonPlanContentBlock } from '@/core/types';
import { CourseArtifactsView } from '@/features/learning/views/CourseArtifactsView';
import type { CourseState } from '@/features/learning/domain/types';

function makeCourse(): CourseState {
  return {
    schemaVersion: 1,
    courseId: 'course-1',
    title: 'Signals',
    goalTitle: 'Understand filters',
    rootPath: 'AI Tutor/Courses/signals',
    currentLessonId: 'lesson-1',
    machineState: 'teaching',
    syllabus: [],
    lessons: [{
      lessonId: 'lesson-1',
      kind: 'lesson',
      chapterNumber: 1,
      title: 'Filters',
      conversationId: 'conv-1',
      status: 'active',
      sections: [
        { id: 's1', title: 'Low-pass intuition', status: 'noteWritten', notePath: 'filters/low-pass.md' },
        { id: 's2', title: 'Cutoff frequency', status: 'pending' },
      ],
      currentSectionIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function makePlan(): LearningLessonPlanContentBlock {
  return {
    type: 'learning_lesson_plan',
    title: 'Filters',
    overview: 'Build intuition before formulas.',
    detail: 'Chapter 1',
    parts: [{
      title: 'Low-pass intuition',
      status: 'current',
      description: 'Understand what low-pass filters keep and remove.',
      bulletPoints: ['Cut high-frequency noise', 'Keep slow signal trend'],
      sources: [{ label: 'Filter notes', path: 'sources/filter-notes.md' }],
    }, {
      title: 'Cutoff frequency',
      status: 'pending',
      description: 'Name the boundary where attenuation starts.',
    }],
    nextLessonSummary: 'Next we will move into sampling.',
  };
}

function createView(plugin: any, contentEl = createMockEl()) {
  const view = new CourseArtifactsView({} as any, plugin);
  (view as any).contentEl = contentEl;
  (view as any).courseId = 'course-1';
  return { view, contentEl };
}

describe('CourseArtifactsView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders lesson plan metadata from conversation UI blocks in the right outline', async () => {
    const openNote = jest.fn();
    const openSource = jest.fn();
    const plugin = {
      learningController: {
        loadCourse: jest.fn(async () => makeCourse()),
        openNote,
        openSource,
      },
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        uiMessageBlocks: {
          'assistant-1': [makePlan()],
        },
        messages: [],
      })),
      getConversationById: jest.fn(),
    };
    const { view, contentEl } = createView(plugin);

    await view.render();

    expect(contentEl.querySelector('.ai-tutor-artifact-plan-overview')?.textContent).toBe('Build intuition before formulas.');
    const parts = contentEl.querySelectorAll('.ai-tutor-artifact-plan-part');
    expect(parts).toHaveLength(2);
    expect(parts[0].querySelector('.ai-tutor-artifact-title')?.textContent).toBe('Low-pass intuition');
    expect(parts[0].querySelector('.ai-tutor-artifact-status')?.textContent).toBe('noteWritten');
    expect(parts[0].querySelector('.ai-tutor-artifact-plan-bullets')?.children[0]?.textContent).toBe('Cut high-frequency noise');
    expect(parts[0].querySelector('.ai-tutor-artifact-source')?.textContent).toBe('Filter notes');
    expect(contentEl.querySelector('.ai-tutor-artifact-next-text')?.textContent).toBe('Next we will move into sampling.');

    (parts[0].querySelector('.ai-tutor-artifact-source') as HTMLElement | null)?.click();
    expect(openSource).toHaveBeenCalledWith({ label: 'Filter notes', path: 'sources/filter-notes.md' });
    expect(openNote).not.toHaveBeenCalled();

    parts[0].click();

    expect(openNote).toHaveBeenCalledWith('filters/low-pass.md');
  });

  it('falls back to section note rows when no lesson plan is persisted', async () => {
    const plugin = {
      learningController: {
        loadCourse: jest.fn(async () => makeCourse()),
        openNote: jest.fn(),
        openSource: jest.fn(),
      },
      getConversationSync: jest.fn(() => ({ id: 'conv-1', uiMessageBlocks: {}, messages: [] })),
      getConversationById: jest.fn(),
    };
    const { view, contentEl } = createView(plugin);

    await view.render();

    expect(contentEl.querySelectorAll('.ai-tutor-artifact-row')).toHaveLength(2);
    expect(contentEl.querySelector('.ai-tutor-artifact-title')?.textContent).toBe('Low-pass intuition');
  });

  it('renders selected section note content and reference material in the right rail', async () => {
    const noteMarkdown = '# Low-pass intuition\n\nThis is the full generated note content.';
    const sourceMarkdown = '# Filter notes\n\nThis is the source material content.';
    const plugin = {
      app: {},
      learningController: {
        loadCourse: jest.fn(async () => makeCourse()),
        openNote: jest.fn(),
        openSource: jest.fn(),
        loadLessonNoteContent: jest.fn(async () => ({
          label: 'Low-pass intuition',
          path: 'filters/low-pass.md',
          text: noteMarkdown,
        })),
        loadSourceContent: jest.fn(async () => ({
          label: 'Filter notes',
          path: 'sources/filter-notes.md',
          text: sourceMarkdown,
        })),
      },
      getConversationSync: jest.fn(() => ({
        id: 'conv-1',
        uiMessageBlocks: {
          'assistant-1': [makePlan()],
        },
        messages: [],
      })),
      getConversationById: jest.fn(),
    };
    const { view, contentEl } = createView(plugin);

    await view.render();

    expect(plugin.learningController.loadLessonNoteContent).toHaveBeenCalledWith(
      'filters/low-pass.md',
      'Low-pass intuition',
    );
    expect(plugin.learningController.loadSourceContent).toHaveBeenCalledWith({
      label: 'Filter notes',
      path: 'sources/filter-notes.md',
    });
    expect(MarkdownRenderer.render).toHaveBeenCalledWith(
      plugin.app,
      noteMarkdown,
      expect.anything(),
      'filters/low-pass.md',
      view,
    );
    expect(MarkdownRenderer.render).toHaveBeenCalledWith(
      plugin.app,
      sourceMarkdown,
      expect.anything(),
      'sources/filter-notes.md',
      view,
    );
    expect(contentEl.querySelector('.ai-tutor-material-section-title')?.textContent).toBe('笔记内容');
    expect(contentEl.querySelector('.ai-tutor-reference-title')?.textContent).toBe('Filter notes');
  });
});
