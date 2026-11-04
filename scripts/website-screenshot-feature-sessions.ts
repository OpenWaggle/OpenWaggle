import path from 'node:path'
import Database from 'better-sqlite3'
import { getDatabasePath, seedSingleSession } from './support/session-fixtures'
import { seedCodemodeSession } from './website-screenshot-codemode-session'
import {
  ANTHROPIC_OPUS,
  COMPACTION_THREAD_TITLE,
  MISSING_WORKTREE_THREAD_TITLE,
  minutesAgo,
} from './website-screenshot-feature-fixture'
import type { ScreenshotProject } from './website-screenshot-project'

/** The Sessions the feature-page captures open: a codemode call, a compaction, a lost worktree. */

const COMPACTION_TOKENS_BEFORE = 182_400
/** A managed-worktree folder that no longer exists, for the missing-worktree banner. */
const MISSING_WORKTREE_ID = 'c2d84e6a'
// When each message was sent, in minutes before the capture; the sidebar shows the last one.
const COMPACTION_PROMPT_MINUTES_AGO = 50
const COMPACTION_FIRST_REPLY_MINUTES_AGO = 48
const COMPACTION_MINUTES_AGO = 10
const COMPACTION_SECOND_PROMPT_MINUTES_AGO = 9
const COMPACTION_ANSWER_MINUTES_AGO = 2
const WORKTREE_PROMPT_MINUTES_AGO = 22
const WORKTREE_ANSWER_MINUTES_AGO = 20

const COMPACTION_NODE_ID = 'website-compaction-summary-1'

/**
 * A long conversation with a manual compaction in the middle. The seeded placeholder message
 * becomes the `compaction_summary` node Pi's compaction entry projects to, so the transcript
 * shows its Context compacted marker with the older messages above it.
 */
async function seedCompactionSession(userDataDir: string, projectPath: string) {
  const now = Date.now()
  const sessionId = await seedSingleSession(userDataDir, {
    title: COMPACTION_THREAD_TITLE,
    projectPath,
    updatedAt: minutesAgo(now, COMPACTION_ANSWER_MINUTES_AGO),
    executionModel: ANTHROPIC_OPUS,
    messages: [
      {
        id: 'website-compaction-user-1',
        role: 'user',
        createdAt: minutesAgo(now, COMPACTION_PROMPT_MINUTES_AGO),
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
        createdAt: minutesAgo(now, COMPACTION_FIRST_REPLY_MINUTES_AGO),
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
        createdAt: minutesAgo(now, COMPACTION_MINUTES_AGO),
        parts: [{ type: 'text', text: 'compaction' }],
      },
      {
        id: 'website-compaction-user-2',
        role: 'user',
        createdAt: minutesAgo(now, COMPACTION_SECOND_PROMPT_MINUTES_AGO),
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
        createdAt: minutesAgo(now, COMPACTION_ANSWER_MINUTES_AGO),
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
async function seedMissingWorktreeSession(
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
    updatedAt: minutesAgo(now, WORKTREE_ANSWER_MINUTES_AGO),
    executionModel: ANTHROPIC_OPUS,
    environmentMode: 'worktree',
    worktreePath,
    messages: [
      {
        id: 'website-worktree-user-1',
        role: 'user',
        createdAt: minutesAgo(now, WORKTREE_PROMPT_MINUTES_AGO),
        parts: [{ type: 'text', text: 'Draft the changelog entry for the settings migration.' }],
      },
      {
        id: 'website-worktree-assistant-1',
        role: 'assistant',
        model: ANTHROPIC_OPUS,
        createdAt: minutesAgo(now, WORKTREE_ANSWER_MINUTES_AGO),
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

/**
 * Seeds the feature Sessions into the running app's Host database on the first call, which
 * resolves true (the caller reloads), and does nothing after that. The first capture that needs
 * them calls it (`CaptureContext.seedFeatureSessionsOnce`), after the older captures ran, so
 * those keep their sidebars unchanged.
 */
export function featureSessionSeeder(input: {
  readonly userDataDir: string
  readonly project: ScreenshotProject
  readonly homeDir: string
}) {
  let seeded = false
  return async () => {
    if (seeded) return false
    seeded = true
    await seedCodemodeSession(input.userDataDir, input.project.projectPath)
    await seedCompactionSession(input.userDataDir, input.project.projectPath)
    await seedMissingWorktreeSession(input.userDataDir, input.project, input.homeDir)
    return true
  }
}
