import type ClaudianPlugin from '../../main';
import { ClaudianTurnAdapter } from './adapters/ClaudianTurnAdapter';
import { FileStateAdapter } from './adapters/FileStateAdapter';
import { ObsidianLayoutAdapter } from './adapters/ObsidianLayoutAdapter';
import { ObsidianNoticeAdapter } from './adapters/ObsidianNoticeAdapter';
import { ObsidianVaultAdapter } from './adapters/ObsidianVaultAdapter';
import { IndexRepository } from './application/IndexRepository';
import { LearningService } from './application/LearningService';
import { SourceLoader } from './application/SourceLoader';
import { StateTransitionService } from './application/StateTransitionService';
import { SkillSeeder } from './application/content/SkillSeeder';
import { LearningStateMachine } from './application/LearningStateMachine';
import { LessonProgression } from './application/coordinators/LessonProgression';
import { SummaryService } from './application/SummaryService';
import { LearningPluginIndex } from './adapters/LearningPluginIndex';

export class LearningController extends LearningService {
  constructor(plugin: ClaudianPlugin) {
    const adapter = new ObsidianVaultAdapter(plugin.app);
    const layout = new ObsidianLayoutAdapter(plugin);
    const turns = new ClaudianTurnAdapter(plugin);
    const notice = new ObsidianNoticeAdapter();
    const index = new LearningPluginIndex(plugin);
    const stateService = new FileStateAdapter(adapter, index);
    const indexRepository = new IndexRepository(stateService);
    const stateMachine = new LearningStateMachine(stateService, indexRepository);
    const transitionService = new StateTransitionService(stateService, indexRepository);
    const sourceLoader = new SourceLoader(adapter, turns);
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
      indexRepository,
      stateService,
      stateMachine,
      transitionService,
      progression,
      skillSeeder: new SkillSeeder(adapter),
      sourceLoader,
    });
  }
}
