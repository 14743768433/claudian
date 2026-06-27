import type ClaudianPlugin from '../../main';
import { ClaudianTurnAdapter } from './adapters/ClaudianTurnAdapter';
import { ObsidianLayoutAdapter } from './adapters/ObsidianLayoutAdapter';
import { ObsidianNoticeAdapter } from './adapters/ObsidianNoticeAdapter';
import { ObsidianVaultAdapter } from './adapters/ObsidianVaultAdapter';
import { LearningService } from './application/LearningService';
import { SkillSeeder } from './content/SkillSeeder';
import { LearningStateMachine } from './flow/LearningStateMachine';
import { LessonProgression } from './application/coordinators/LessonProgression';
import { SummaryService } from './application/SummaryService';
import { LearningPluginIndex } from './state/LearningPluginIndex';
import { LearningStateService } from './state/LearningStateService';

export class LearningController extends LearningService {
  constructor(plugin: ClaudianPlugin) {
    const adapter = new ObsidianVaultAdapter(plugin.app);
    const layout = new ObsidianLayoutAdapter(plugin);
    const turns = new ClaudianTurnAdapter(plugin);
    const notice = new ObsidianNoticeAdapter();
    const index = new LearningPluginIndex(plugin);
    const stateService = new LearningStateService(adapter, index);
    const stateMachine = new LearningStateMachine(stateService);
    const progression = new LessonProgression(
      turns,
      stateMachine,
      new SummaryService(turns),
      notice,
    );
    super({
      adapter,
      layout,
      turns,
      notice,
      index,
      stateService,
      stateMachine,
      progression,
      skillSeeder: new SkillSeeder(adapter),
    });
  }
}
