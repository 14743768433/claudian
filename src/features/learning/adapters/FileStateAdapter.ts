import { LearningPluginIndex } from '../state/LearningPluginIndex';
import { LearningStateService } from '../state/LearningStateService';
import type { CourseIndexEntry, LoadedLessonRef } from '../state/types';
import type { StatePort } from '../ports/StatePort';
import type { VaultPort } from '../ports/VaultPort';

export class FileStateAdapter extends LearningStateService implements StatePort {
  constructor(
    vault: VaultPort,
    private readonly indexStore: LearningPluginIndex,
  ) {
    super(vault, indexStore);
  }

  async listIndex(): Promise<CourseIndexEntry[]> {
    return this.indexStore.listCourses();
  }

  async upsertIndex(entry: CourseIndexEntry): Promise<void> {
    await this.indexStore.upsertCourse(entry);
  }

  async removeIndex(courseId: string): Promise<void> {
    await this.indexStore.removeCourse(courseId);
  }

  override async findByConversationId(conversationId: string): Promise<LoadedLessonRef | null> {
    return super.findByConversationId(conversationId);
  }

}
