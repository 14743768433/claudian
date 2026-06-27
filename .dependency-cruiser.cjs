const LEARN = '^src/features/learning';
const OBSIDIAN = '^obsidian$';
const WARN = 'warn';

module.exports = {
  forbidden: [
    {
      name: 'learning-domain-pure',
      severity: WARN,
      from: { path: `${LEARN}/domain` },
      to: {
        path: [
          OBSIDIAN,
          `${LEARN}/(application|ports|adapters|views)`,
          '^src/(main|core|features/chat|providers)',
        ],
      },
    },
    {
      name: 'learning-application-no-obsidian',
      severity: WARN,
      from: { path: `${LEARN}/application` },
      to: { path: OBSIDIAN },
    },
    {
      name: 'learning-application-no-chat-internals',
      severity: WARN,
      from: { path: `${LEARN}/application` },
      to: { path: '^src/(main|core/runtime|features/chat)' },
    },
    {
      name: 'learning-only-adapters-views-controller-import-obsidian',
      severity: WARN,
      from: {
        path: LEARN,
        pathNot: `${LEARN}/(adapters|views)|${LEARN}/LearningController`,
      },
      to: { path: OBSIDIAN },
    },
    {
      name: 'learning-adapters-no-application',
      severity: WARN,
      from: { path: `${LEARN}/adapters` },
      to: { path: `${LEARN}/application` },
    },
    {
      name: 'learning-views-no-domain-logic',
      severity: WARN,
      from: { path: `${LEARN}/views` },
      to: {
        path: `${LEARN}/domain`,
        pathNot: `${LEARN}/domain/types`,
      },
    },
    {
      name: 'learning-ports-are-pure',
      severity: WARN,
      from: { path: `${LEARN}/ports` },
      to: { path: `${LEARN}/(application|adapters|views|domain)/` },
    },
    {
      name: 'learning-no-direct-file-state-adapter-imports',
      severity: WARN,
      from: {
        path: LEARN,
        pathNot: `${LEARN}/application/StateTransitionService|${LEARN}/application/IndexRepository|${LEARN}/LearningController`,
      },
      to: { path: `${LEARN}/adapters/FileStateAdapter` },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
};
