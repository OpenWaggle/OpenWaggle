import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { SupportedModelId } from '@shared/types/brand'
import Database from 'better-sqlite3'
import { getDatabasePath, seedSingleSession } from './support/session-fixtures'
import type { ScreenshotProject } from './website-screenshot-project'

const execFileAsync = promisify(execFile)

export const CODEMODE_THREAD_TITLE = 'Find the TODOs left in the API client'
// No title may contain "Settings": the existing captures find the sidebar's Settings button by substring.
export const COMPACTION_THREAD_TITLE = 'Move app preferences to SQLite'
export const MISSING_WORKTREE_THREAD_TITLE = 'Draft the changelog entry'
/** The Session the Waggle capture starts from the message box, so its title comes from the fake model. */
export const WAGGLE_THREAD_TITLE = 'Review API client error handling'
export const WAGGLE_PRESET_NAME = 'Code Review'
/** A managed-worktree folder that no longer exists, for the missing-worktree banner. */
const MISSING_WORKTREE_ID = 'c2d84e6a'

const ANTHROPIC_OPUS = SupportedModelId('anthropic/claude-opus-4-6')
const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const CODEMODE_CALL_ID = 'website-codemode-1'
const COMPACTION_TOKENS_BEFORE = 182_400

const GIT_IDENTITY = [
  '-c',
  'user.name=OpenWaggle Screenshot Fixture',
  '-c',
  'user.email=screenshots@openwaggle.local',
] as const

const PROJECT_FILES: Readonly<Record<string, string>> = {
  // Project Waggle presets live in `.pi/`; ignored, so saving one leaves the Changes panel alone.
  '.gitignore': '.pi/\n',
  'AGENTS.md': [
    '# Project instructions',
    '',
    '- Use pnpm for every package command.',
    '- Run `pnpm test` before you report a change as done.',
    '',
  ].join('\n'),
  '.agents/skills/review-change/SKILL.md': [
    '---',
    'name: review-change',
    'description: Review a Git diff for bugs, regressions, and missing tests.',
    '---',
    '',
    '# Review a change',
    '',
    'Read the diff and the affected callers before drawing conclusions.',
    'Report concrete defects with file and line references.',
    'Do not edit files unless asked. State which checks you ran and which you did not.',
    '',
  ].join('\n'),
  '.openwaggle/skills/write-migration/SKILL.md': [
    '---',
    'name: write-migration',
    'description: Write a forward-only SQLite migration with a test that runs it on a copy of real data.',
    '---',
    '',
    '# Write a migration',
    '',
    'Add the next numbered file under `src/db/migrations/`. Never edit a migration that has shipped.',
    'Write a test that applies every migration in order to the fixture database.',
    '',
  ].join('\n'),
  '.agents/agents/release-verifier.md': [
    '---',
    'name: release-verifier',
    'description: Checks a release candidate against the release checklist',
    'tools: read, grep, bash',
    '---',
    '',
    'Work through the release checklist in `docs/release.md` in order.',
    'Report each item as passed, failed or not checked, with the command you ran.',
    '',
  ].join('\n'),
  '.openwaggle/agents/code-reviewer.md': [
    '---',
    'name: code-reviewer',
    'description: Reviews code for concrete defects',
    'tools: read, grep',
    '---',
    '',
    'Review the change and report actionable findings with file references.',
    '',
  ].join('\n'),
}

/**
 * Project instructions, two skills and two agent definitions for Settings > Skills and Agents.
 * Committed, so the Changes panel still shows only the fixture's README edit.
 */
export async function addFeatureProjectFiles(project: ScreenshotProject) {
  for (const [relativePath, content] of Object.entries(PROJECT_FILES)) {
    const target = path.join(project.projectPath, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }
  await execFileAsync('git', [...GIT_IDENTITY, 'add', ...Object.keys(PROJECT_FILES)], {
    cwd: project.projectPath,
  })
  await execFileAsync('git', [...GIT_IDENTITY, 'commit', '-m', 'chore: add agent instructions'], {
    cwd: project.projectPath,
  })
}

const CODEMODE_SCRIPT = [
  "const files = ['src/api/client.ts', 'src/api/retry.ts', 'src/api/errors.ts']",
  'const results = await Promise.allSettled(',
  '  files.map((path) => tools.read({ path })),',
  ')',
  "const todos = await tools.grep({ pattern: 'TODO', path: 'src/api' })",
  'for (const [i, result] of results.entries()) {',
  "  if (result.status === 'rejected') console.log(files[i], result.reason)",
  '}',
  'console.log(todos.output)',
].join('\n')

const CODEMODE_OUTPUT = [
  'src/api/errors.ts Error: ENOENT: no such file or directory',
  'src/api/client.ts:42: // TODO: retry on 429 with Retry-After',
  'src/api/client.ts:88: // TODO: surface the request id in thrown errors',
  'src/api/retry.ts:17: // TODO: cap total backoff at 30s',
].join('\n')

const CODEMODE_CALLS = [
  { name: 'read', args: '{"path":"src/api/client.ts"}', status: 'ok', durationMs: 14 },
  { name: 'read', args: '{"path":"src/api/retry.ts"}', status: 'ok', durationMs: 11 },
  {
    name: 'read',
    args: '{"path":"src/api/errors.ts"}',
    status: 'error',
    durationMs: 3,
    error: 'ENOENT: no such file or directory',
  },
  { name: 'grep', args: '{"pattern":"TODO","path":"src/api"}', status: 'ok', durationMs: 38 },
].map((call, index) => ({ id: `${CODEMODE_CALL_ID}/${String(index + 1)}`, ...call }))

/** A transcript with one finished codemode call: four tool calls, one of them failed. */
export async function seedCodemodeSession(userDataDir: string, projectPath: string) {
  const now = Date.now()
  const codemodeResult = {
    content: [{ type: 'text', text: CODEMODE_OUTPUT }],
    details: { calls: CODEMODE_CALLS },
  }
  return seedSingleSession(userDataDir, {
    title: CODEMODE_THREAD_TITLE,
    projectPath,
    updatedAt: now - 3 * MINUTE_MS,
    executionModel: ANTHROPIC_OPUS,
    messages: [
      {
        id: 'website-codemode-user-1',
        role: 'user',
        createdAt: now - 5 * MINUTE_MS,
        parts: [
          {
            type: 'text',
            text: 'Which TODOs are still open in the API client? Group them by file.',
          },
        ],
      },
      {
        id: 'website-codemode-assistant-1',
        role: 'assistant',
        model: 'anthropic/claude-opus-4-6',
        createdAt: now - 4 * MINUTE_MS,
        parts: [
          {
            type: 'tool-call',
            toolCall: { id: CODEMODE_CALL_ID, name: 'codemode', args: { code: CODEMODE_SCRIPT } },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: CODEMODE_CALL_ID,
              name: 'codemode',
              args: { code: CODEMODE_SCRIPT },
              result: codemodeResult,
              isError: false,
              duration: 412,
              details: codemodeResult.details,
            },
          },
        ],
      },
      {
        id: 'website-codemode-assistant-2',
        role: 'assistant',
        model: 'anthropic/claude-opus-4-6',
        createdAt: now - 3 * MINUTE_MS,
        parts: [
          {
            type: 'text',
            text: [
              'Three TODOs are open in `src/api`:',
              '',
              '- `client.ts:42`: retry on 429 using `Retry-After`.',
              '- `client.ts:88`: include the request id in thrown errors.',
              '- `retry.ts:17`: cap the total backoff at 30 seconds.',
              '',
              "`src/api/errors.ts` doesn't exist, so the error types live in `client.ts` for now.",
            ].join('\n'),
          },
        ],
      },
    ],
  })
}

const COMPACTION_NODE_ID = 'website-compaction-summary-1'

/**
 * A long conversation with a manual compaction in the middle. The seeded placeholder message
 * becomes the `compaction_summary` node Pi's compaction entry projects to, so the transcript
 * shows its Context compacted marker with the older messages above it.
 */
export async function seedCompactionSession(userDataDir: string, projectPath: string) {
  const now = Date.now()
  const sessionId = await seedSingleSession(userDataDir, {
    title: COMPACTION_THREAD_TITLE,
    projectPath,
    updatedAt: now - 2 * MINUTE_MS,
    executionModel: ANTHROPIC_OPUS,
    messages: [
      {
        id: 'website-compaction-user-1',
        role: 'user',
        createdAt: now - 50 * MINUTE_MS,
        parts: [
          {
            type: 'text',
            text: 'Move the settings store from the JSON file to SQLite. Keep reading the old file once so nobody loses their settings.',
          },
        ],
      },
      {
        id: 'website-compaction-assistant-1',
        role: 'assistant',
        model: 'anthropic/claude-opus-4-6',
        createdAt: now - 48 * MINUTE_MS,
        parts: [
          {
            type: 'text',
            text: [
              'The store now writes to a `settings` table, and the first start after the update imports `settings.json` once and renames it to `settings.json.migrated`.',
              '',
              'Done so far:',
              '',
              '- `src/db/migrations/0012_settings.sql` creates the table.',
              '- `SettingsStore` reads and writes through `better-sqlite3`.',
              '- `importLegacySettings()` runs before the first read.',
              '',
              'Still to do: the tests for a corrupt legacy file, and the Windows path case.',
            ].join('\n'),
          },
        ],
      },
      {
        id: COMPACTION_NODE_ID,
        role: 'system',
        createdAt: now - 10 * MINUTE_MS,
        parts: [{ type: 'text', text: 'compaction' }],
      },
      {
        id: 'website-compaction-user-2',
        role: 'user',
        createdAt: now - 9 * MINUTE_MS,
        parts: [
          {
            type: 'text',
            text: 'Now add the tests for a corrupt legacy file and for a settings path with spaces on Windows.',
          },
        ],
      },
      {
        id: 'website-compaction-assistant-2',
        role: 'assistant',
        model: 'anthropic/claude-opus-4-6',
        createdAt: now - 2 * MINUTE_MS,
        parts: [
          {
            type: 'text',
            text: [
              'Added both tests in `src/settings/__tests__/import-legacy.test.ts`:',
              '',
              '- A truncated `settings.json` is kept as `settings.json.corrupt`, and the store starts from defaults.',
              '- A profile path with spaces imports and renames the legacy file on Windows.',
              '',
              '`pnpm test src/settings` passes: 14 tests.',
            ].join('\n'),
          },
        ],
      },
    ],
  })
  const database = new Database(getDatabasePath(userDataDir))
  try {
    database
      .prepare(
        `UPDATE session_nodes
         SET pi_entry_type = 'compaction', kind = 'compaction_summary', role = NULL, content_json = ?
         WHERE id = ? AND session_id = ?`,
      )
      .run(
        JSON.stringify({
          summary: [
            '## Goal',
            'Move the settings store from settings.json to SQLite and import the old file once.',
            '',
            '## Done',
            '- Migration 0012 and SettingsStore on better-sqlite3; importLegacySettings() before the first read.',
            '',
            '## Next',
            '- Tests for a corrupt legacy file and a Windows path with spaces.',
          ].join('\n'),
          firstKeptEntryId: 'website-compaction-user-2',
          tokensBefore: COMPACTION_TOKENS_BEFORE,
          fromHook: false,
          reason: 'manual',
        }),
        COMPACTION_NODE_ID,
        sessionId,
      )
  } finally {
    database.close()
  }
  return sessionId
}

/** A Session whose managed worktree folder was deleted, so new messages are blocked. */
export async function seedMissingWorktreeSession(
  userDataDir: string,
  project: ScreenshotProject,
  homeDir: string,
) {
  const now = Date.now()
  const worktreePath = path.join(
    homeDir,
    '.openwaggle',
    'worktrees',
    path.basename(project.projectPath),
    MISSING_WORKTREE_ID,
  )
  return seedSingleSession(userDataDir, {
    title: MISSING_WORKTREE_THREAD_TITLE,
    projectPath: project.projectPath,
    updatedAt: now - 20 * MINUTE_MS,
    executionModel: ANTHROPIC_OPUS,
    environmentMode: 'worktree',
    worktreePath,
    messages: [
      {
        id: 'website-worktree-user-1',
        role: 'user',
        createdAt: now - 22 * MINUTE_MS,
        parts: [{ type: 'text', text: 'Draft the changelog entry for the settings migration.' }],
      },
      {
        id: 'website-worktree-assistant-1',
        role: 'assistant',
        model: ANTHROPIC_OPUS,
        createdAt: now - 20 * MINUTE_MS,
        parts: [
          {
            type: 'text',
            text: 'I added a draft under **Unreleased** in `CHANGELOG.md`: "Settings are now stored in SQLite. Your existing settings are imported on first start."',
          },
        ],
      },
    ],
  })
}

interface FeatureSessionsInput {
  readonly userDataDir: string
  readonly project: ScreenshotProject
  readonly homeDir: string
}

let pendingFeatureSessions: FeatureSessionsInput | null = null

/**
 * Remembers where to seed the feature Sessions. They are seeded by the first capture that needs
 * them, after the older captures ran, so those keep their sidebars unchanged.
 */
export function registerFeatureSessions(input: FeatureSessionsInput) {
  pendingFeatureSessions = input
}

/** Seeds the feature Sessions once into the running app's Host database; the caller reloads. */
export async function seedFeatureSessionsOnce() {
  const input = pendingFeatureSessions
  if (!input) return false
  pendingFeatureSessions = null
  await seedCodemodeSession(input.userDataDir, input.project.projectPath)
  await seedCompactionSession(input.userDataDir, input.project.projectPath)
  await seedMissingWorktreeSession(input.userDataDir, input.project, input.homeDir)
  return true
}
