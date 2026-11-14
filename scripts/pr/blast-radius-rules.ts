export type RiskLevel = 'High' | 'Low' | 'Medium'

export interface ChangedFile {
  readonly path: string
  readonly previousPath?: string
  readonly status: string
}

interface AreaDefinition {
  readonly key: string
  readonly label: string
  readonly matches: (filePath: string) => boolean
  readonly risk: RiskLevel
}

const LOW_RANK = 1
const MEDIUM_RANK = 2
const HIGH_RANK = 3
const RISK_RANK: Record<RiskLevel, number> = { High: HIGH_RANK, Low: LOW_RANK, Medium: MEDIUM_RANK }

export function compareRisk(left: RiskLevel, right: RiskLevel) {
  return RISK_RANK[left] - RISK_RANK[right]
}

function startsWithAny(filePath: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => filePath.startsWith(prefix))
}

const RELEASE_FILES = new Set([
  '.release-please-manifest.json',
  'bun.lock',
  'bun.lockb',
  'bunfig.toml',
  'electron-builder.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'release-please-config.json',
  'scripts/install.sh',
])
const RELEASE_SCRIPT_PATTERN =
  /^scripts\/(?:app-release|package-release|mac-signing|verify-release)/
const TOOLING_CONFIG_PATTERN =
  /^(?:tsconfig[^/]*\.json|vitest[^/]*\.ts|oxlint\.config\.mts|\.oxfmtrc\.json|tools\/bun-lint\/.+|\.fallowrc\.jsonc|electron\.vite\.config\.ts|doctor\.config\.ts)$/
const AGENT_FILES = new Set(['AGENTS.md', 'CONTEXT.md', 'MEMORY.md'])
const PROJECT_DOCS = new Set(['CHANGELOG.md', 'CONTRIBUTING.md', 'README.md'])

/** First match wins, so the narrow, riskier areas come before the broad ones. */
const AREA_DEFINITIONS: readonly AreaDefinition[] = [
  {
    key: 'ci-release',
    label: 'CI, hooks, release and dependency lock',
    risk: 'High',
    matches: (filePath) =>
      RELEASE_FILES.has(filePath) ||
      RELEASE_SCRIPT_PATTERN.test(filePath) ||
      startsWithAny(filePath, ['.github/', '.husky/', 'build/', 'packaging/', 'patches/']),
  },
  {
    key: 'tests',
    label: 'Tests and fixtures',
    risk: 'Medium',
    matches: (filePath) =>
      filePath.includes('/__tests__/') ||
      /\.test\.[cm]?tsx?$/.test(filePath) ||
      startsWithAny(filePath, ['tests/', 'fixtures/']),
  },
  {
    key: 'packages',
    label: 'Publishable npm packages',
    risk: 'High',
    matches: (filePath) => filePath.startsWith('packages/'),
  },
  {
    key: 'pi-runtime',
    label: 'Pi runtime adapters',
    risk: 'High',
    matches: (filePath) => filePath.startsWith('src/main/adapters/pi/'),
  },
  {
    key: 'persistence',
    label: 'Persistence and migrations',
    risk: 'High',
    matches: (filePath) => startsWithAny(filePath, ['src/main/store/', 'src/main/migrations/']),
  },
  {
    key: 'trust-boundary',
    label: 'Preload, IPC, auth and security',
    risk: 'High',
    matches: (filePath) =>
      startsWithAny(filePath, [
        'src/preload/',
        'src/main/ipc/',
        'src/main/security/',
        'src/main/auth/',
      ]),
  },
  {
    key: 'main',
    label: 'Main process',
    risk: 'Medium',
    matches: (filePath) => filePath.startsWith('src/main/'),
  },
  {
    key: 'shared',
    label: 'Shared types, schemas and utilities',
    risk: 'Medium',
    matches: (filePath) => filePath.startsWith('src/shared/'),
  },
  {
    key: 'renderer',
    label: 'Renderer',
    risk: 'Medium',
    matches: (filePath) => filePath.startsWith('src/renderer/'),
  },
  {
    key: 'tooling',
    label: 'Build, lint and test configuration',
    risk: 'Medium',
    matches: (filePath) => TOOLING_CONFIG_PATTERN.test(filePath),
  },
  {
    key: 'agent-tooling',
    label: 'Agent instructions, skills and scripts',
    risk: 'Medium',
    matches: (filePath) =>
      AGENT_FILES.has(filePath) ||
      startsWithAny(filePath, ['.agents/', '.codex/', 'docs/agents/', 'scripts/']),
  },
  {
    key: 'website',
    label: 'Website and user docs',
    risk: 'Low',
    matches: (filePath) =>
      filePath === 'wrangler.toml' || startsWithAny(filePath, ['website/', 'functions/']),
  },
  {
    key: 'docs',
    label: 'ADRs and project docs',
    risk: 'Low',
    matches: (filePath) => PROJECT_DOCS.has(filePath) || filePath.startsWith('docs/'),
  },
]

const FALLBACK_AREA: AreaDefinition = {
  key: 'other',
  label: 'Other files',
  risk: 'Low',
  matches: () => true,
}

export function classifyArea(filePath: string) {
  return AREA_DEFINITIONS.find((area) => area.matches(filePath)) ?? FALLBACK_AREA
}
