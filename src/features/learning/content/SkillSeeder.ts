import type { VaultPort } from '../ports/VaultPort';
import { TransformationRegistry } from './TransformationRegistry';

const SKILL_DIR_BY_ID = {
  'lesson-page': 'lesson-page',
  quiz: 'quiz',
  review: 'review',
  'concept-card': 'concept-card',
} as const;

export class SkillSeeder {
  constructor(
    private readonly adapter: Pick<VaultPort, 'exists' | 'write'>,
    private readonly registry = new TransformationRegistry(),
  ) {}

  async seedVaultSkills(): Promise<void> {
    for (const template of this.registry.list()) {
      const dir = SKILL_DIR_BY_ID[template.id];
      const path = `.claude/skills/${dir}/SKILL.md`;
      if (await this.adapter.exists(path)) continue;
      await this.adapter.write(path, template.body.endsWith('\n') ? template.body : `${template.body}\n`);
    }
  }
}
