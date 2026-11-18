import fs from 'node:fs/promises'
import path from 'node:path'
import { fixtureGit } from './website-screenshot-fixture-git'

const JSON_INDENT = 2

export const ESSENTIALS_PROJECT_NAME = 'jotter'
/** A managed worktree on a feature branch with an upstream it is ahead of and behind. */
const ESSENTIALS_WORKTREE_ID = '5d2e81b4'
const ESSENTIALS_FEATURE_BRANCH = 'feature/settings-schema'

export interface EssentialsProject {
  readonly projectPath: string
  readonly featureWorktreePath: string
}

const PACKAGE_JSON = {
  name: 'jotter',
  version: '0.4.0',
  private: true,
  type: 'module',
  packageManager: 'pnpm@10.12.1',
  scripts: {
    dev: 'node scripts/dev.mjs',
    test: 'node scripts/test.mjs',
    lint: 'node scripts/lint.mjs',
    build: 'node scripts/build.mjs',
  },
}

/** Deterministic stand-ins for a test runner, linter, build and dev server; no dependencies. */
const SCRIPT_FILES: Readonly<Record<string, string>> = {
  'scripts/test.mjs': [
    'const lines = [',
    "  ' RUN  v3.2.4 jotter',",
    "  '',",
    "  ' ✓ src/notes/__tests__/notes-store.test.ts (14 tests) 38ms',",
    "  ' ✓ src/sync/__tests__/conflict-resolver.test.ts (9 tests) 21ms',",
    "  ' ✓ src/upload/__tests__/retry.test.ts (6 tests) 112ms',",
    "  '',",
    "  ' Test Files  3 passed (3)',",
    "  '      Tests  29 passed (29)',",
    "  '   Duration  1.42s',",
    ']',
    'for (const line of lines) console.log(line)',
    '',
  ].join('\n'),
  'scripts/lint.mjs': [
    "console.log('Checking 48 files...')",
    "console.error('src/upload/retry.ts:27:9  error  Unexpected floating promise  no-floating-promises')",
    "console.error('')",
    "console.error('✖ 1 problem (1 error, 0 warnings)')",
    'process.exitCode = 1',
    '',
  ].join('\n'),
  'scripts/build.mjs': [
    "console.log('vite v7.1.3 building for production...')",
    "console.log('✓ 214 modules transformed.')",
    "console.log('dist/index.html                  0.62 kB')",
    "console.log('dist/assets/index-4f1c2a9e.css  18.40 kB')",
    "console.log('dist/assets/index-9b7d3e21.js  142.87 kB')",
    "console.log('✓ built in 2.31s')",
    '',
  ].join('\n'),
  'scripts/dev.mjs': [
    "console.log('')",
    "console.log('  VITE v7.1.3  ready in 412 ms')",
    "console.log('')",
    "console.log('  ➜  Local:   http://localhost:5173/')",
    "console.log('  ➜  Network: use --host to expose')",
    '// A dev server keeps running until it is stopped.',
    'setInterval(() => {}, 60_000)',
    '',
  ].join('\n'),
}

/** The committed `src/upload/retry.ts`: it retries every response that is not ok, 4xx included. */
export const RETRY_SOURCE = [
  "import { sleep } from '../util/sleep'",
  '',
  'export interface RetryOptions {',
  '  readonly attempts: number',
  '  readonly baseDelayMs: number',
  '}',
  '',
  '/** Uploads a note attachment, retrying transient failures with exponential backoff. */',
  'export async function uploadWithRetry(',
  '  upload: () => Promise<Response>,',
  '  options: RetryOptions,',
  '): Promise<Response> {',
  '  let lastError: unknown',
  '  for (let attempt = 0; attempt < options.attempts; attempt += 1) {',
  '    try {',
  '      const response = await upload()',
  '      if (response.ok) return response',
  '      lastError = new Error(`Upload failed with ${response.status}`)',
  '    } catch (error) {',
  '      lastError = error',
  '    }',
  '    await sleep(options.baseDelayMs * 2 ** attempt)',
  '  }',
  '  throw lastError',
  '}',
  '',
].join('\n')

/**
 * The uncommitted change the Changes panel and its review comment show: the base retries every
 * failed response, and the change returns client errors at once, except 408 and 429.
 */
const RETRY_SOURCE_CHANGED = RETRY_SOURCE.replace(
  '      if (response.ok) return response\n',
  '      if (response.ok) return response\n      if (!isRetryable(response.status)) return response\n',
).replace(
  "import { sleep } from '../util/sleep'\n",
  "import { sleep } from '../util/sleep'\n\nconst RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])\n\nfunction isRetryable(status: number) {\n  return RETRYABLE_STATUSES.has(status)\n}\n",
)

const PROJECT_FILES: Readonly<Record<string, string>> = {
  'README.md': [
    '# Jotter',
    '',
    'A small team notebook: notes, attachments and offline sync.',
    '',
    '## Development',
    '',
    '```sh',
    'pnpm install',
    'pnpm dev',
    '```',
    '',
  ].join('\n'),
  'package.json': `${JSON.stringify(PACKAGE_JSON, null, 2)}\n`,
  'src/upload/retry.ts': RETRY_SOURCE,
  'src/util/sleep.ts':
    'export function sleep(ms: number) {\n  return new Promise((resolve) => setTimeout(resolve, ms))\n}\n',
  'src/upload/__tests__/retry.test.ts': [
    "import { describe, expect, it } from 'vitest'",
    "import { uploadWithRetry } from '../retry'",
    '',
    "describe('uploadWithRetry', () => {",
    "  it('retries a 503 and returns the next success', async () => {",
    '    const responses = [new Response(null, { status: 503 }), new Response(null, { status: 201 })]',
    '    const result = await uploadWithRetry(async () => responses.shift()!, { attempts: 3, baseDelayMs: 1 })',
    '    expect(result.status).toBe(201)',
    '  })',
    '})',
    '',
  ].join('\n'),
  ...SCRIPT_FILES,
  // Project skills, so the composer's / menu lists more than the built-in commands.
  '.agents/skills/release-notes/SKILL.md': [
    '---',
    'name: release-notes',
    'description: Draft release notes from the commits since the last tag.',
    '---',
    '',
    'Group changes by user-visible feature. Leave out refactors and test-only commits.',
    '',
  ].join('\n'),
  '.agents/skills/regression-test/SKILL.md': [
    '---',
    'name: regression-test',
    'description: Reproduce a reported bug with a failing test before fixing it.',
    '---',
    '',
    'Write the smallest test that fails for the reported reason, then fix the code.',
    '',
  ].join('\n'),
}

/**
 * Saved Project actions, shared in the repository: a test run, a lint that fails and a build use
 * the project's scripts; the dev server is a command of its own, so its terminal output has no
 * package manager banner naming the scratch path.
 */
const ACTION_MANIFEST = {
  version: 1,
  actions: [
    { id: 'dev', name: 'Dev server', icon: 'play', kind: 'service' },
    { id: 'test', name: 'Run tests', icon: 'test', kind: 'task' },
    { id: 'lint', name: 'Lint', icon: 'lint', kind: 'task' },
    { id: 'build', name: 'Build', icon: 'build', kind: 'task' },
  ].map(({ id, name, icon, kind }) => ({
    id,
    name,
    icon,
    invocation:
      kind === 'service'
        ? { type: 'command', command: `node scripts/${id}.mjs`, directory: '.' }
        : {
            type: 'task',
            task: { provider: 'package-script', source: 'package.json', task: id, directory: '.' },
          },
    kind,
    allowConcurrent: false,
    autoOpenPreview: false,
  })),
  profiles: [],
  preparation: [],
}

async function writeFiles(root: string, files: Readonly<Record<string, string>>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }
}

/**
 * A second project, so the essentials screenshots add nothing to the first project's sidebar:
 * a Git repository with an `origin`, saved Project actions, an uncommitted change, and a managed
 * worktree on a feature branch that is two commits ahead of its upstream and one behind.
 */
export async function createEssentialsProject(input: {
  readonly scratchRoot: string
  readonly homeDir: string
}) {
  const git = (cwd: string, args: readonly string[]) => fixtureGit(cwd, args, input.homeDir)
  const projectPath = path.join(input.scratchRoot, ESSENTIALS_PROJECT_NAME)
  const remotePath = path.join(input.scratchRoot, 'remotes', `${ESSENTIALS_PROJECT_NAME}.git`)
  await fs.mkdir(projectPath, { recursive: true })
  await fs.mkdir(remotePath, { recursive: true })
  await git(remotePath, ['init', '--bare', '--initial-branch=main'])
  await git(projectPath, ['init', '--initial-branch=main'])
  await writeFiles(projectPath, {
    ...PROJECT_FILES,
    '.openwaggle/actions.json': `${JSON.stringify(ACTION_MANIFEST, null, JSON_INDENT)}\n`,
  })
  await git(projectPath, ['add', '.'])
  await git(projectPath, ['commit', '-m', 'chore: start jotter'])
  await git(projectPath, ['remote', 'add', 'origin', remotePath])
  await git(projectPath, ['push', '-u', 'origin', 'main'])

  const realProjectPath = await fs.realpath(projectPath)
  const worktreeRoot = path.join(input.homeDir, '.openwaggle', 'worktrees', ESSENTIALS_PROJECT_NAME)
  await fs.mkdir(worktreeRoot, { recursive: true })
  const featureWorktreePath = path.join(await fs.realpath(worktreeRoot), ESSENTIALS_WORKTREE_ID)
  await git(realProjectPath, [
    'worktree',
    'add',
    '-b',
    ESSENTIALS_FEATURE_BRANCH,
    featureWorktreePath,
    'main',
  ])
  await writeFiles(featureWorktreePath, {
    'src/settings/schema.ts': 'export const SETTINGS_VERSION = 2\n',
  })
  await git(featureWorktreePath, ['add', '.'])
  await git(featureWorktreePath, ['commit', '-m', 'feat(settings): add schema version'])
  await git(featureWorktreePath, ['push', '-u', 'origin', ESSENTIALS_FEATURE_BRANCH])
  // A teammate's commit on the remote branch: one behind.
  await git(featureWorktreePath, [
    'commit',
    '--allow-empty',
    '-m',
    'docs(settings): note the migration',
  ])
  await git(featureWorktreePath, ['push', 'origin', ESSENTIALS_FEATURE_BRANCH])
  await git(featureWorktreePath, ['reset', '--hard', 'HEAD~1'])
  // Two local commits not pushed yet: two ahead.
  await writeFiles(featureWorktreePath, {
    'src/settings/migrate.ts': 'export function migrate() {}\n',
  })
  await git(featureWorktreePath, ['add', '.'])
  await git(featureWorktreePath, ['commit', '-m', 'feat(settings): migrate version 1 files'])
  await git(featureWorktreePath, [
    'commit',
    '--allow-empty',
    '-m',
    'test(settings): cover the migration',
  ])

  await fs.writeFile(
    path.join(realProjectPath, 'src/upload/retry.ts'),
    RETRY_SOURCE_CHANGED,
    'utf8',
  )
  return { projectPath: realProjectPath, featureWorktreePath }
}
