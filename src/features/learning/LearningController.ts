import type ClaudianPlugin from '../../main';
import { LearningService } from './application/LearningService';

export class LearningController extends LearningService {
  constructor(plugin: ClaudianPlugin) {
    super(plugin);
  }
}
