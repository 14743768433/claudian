import { ObsidianLayoutAdapter } from '@/features/learning/adapters/ObsidianLayoutAdapter';
import {
  VIEW_TYPE_CHAPTER_LIST,
  VIEW_TYPE_COURSE_ARTIFACTS,
} from '@/features/learning/views/viewTypes';

function makeLeaf() {
  return {
    view: {
      setCourseId: jest.fn(),
    },
    setViewState: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ObsidianLayoutAdapter', () => {
  it('reveals the learning side leaves when arranging a course layout', async () => {
    const leftLeaf = makeLeaf();
    const rightLeaf = makeLeaf();
    const workspace = {
      getLeftLeaf: jest.fn().mockReturnValue(leftLeaf),
      getRightLeaf: jest.fn().mockReturnValue(rightLeaf),
      revealLeaf: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = new ObsidianLayoutAdapter({
      app: { workspace },
    } as any);

    await adapter.ensureSideLeaves('course-1');

    expect(leftLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_CHAPTER_LIST,
      active: true,
    });
    expect(rightLeaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE_COURSE_ARTIFACTS,
      active: true,
    });
    expect(leftLeaf.view.setCourseId).toHaveBeenCalledWith('course-1');
    expect(rightLeaf.view.setCourseId).toHaveBeenCalledWith('course-1');
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leftLeaf);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
  });

  it('creates side leaves when the workspace has none available yet', async () => {
    const leftLeaf = makeLeaf();
    const rightLeaf = makeLeaf();
    const workspace = {
      getLeftLeaf: jest.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(leftLeaf),
      getRightLeaf: jest.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(rightLeaf),
      revealLeaf: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = new ObsidianLayoutAdapter({
      app: { workspace },
    } as any);

    await adapter.ensureSideLeaves('course-1');

    expect(workspace.getLeftLeaf).toHaveBeenNthCalledWith(1, false);
    expect(workspace.getLeftLeaf).toHaveBeenNthCalledWith(2, true);
    expect(workspace.getRightLeaf).toHaveBeenNthCalledWith(1, false);
    expect(workspace.getRightLeaf).toHaveBeenNthCalledWith(2, true);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(rightLeaf);
  });
});
