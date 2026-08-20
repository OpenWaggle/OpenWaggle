/**
 * Seed the development database with large, distinct conversations.
 *
 * Switching sessions is only testable when each session's transcript is obviously its own, and
 * long enough to cost something to mount. Empty sessions make a broken switch look identical to
 * a working one.
 *
 * Run with the app closed, then start it:
 *   pnpm qa:seed-conversations [--messages 400] [--replace-qa]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { seedSessions } from '../../e2e/support/session-fixtures'

const DEFAULT_MESSAGE_COUNT = 400
const ROLE_ALTERNATION = 2
const PARAGRAPH_REPEATS = 3
const ONE_MINUTE_MS = 60_000
const ONE_HOUR_MS = 3_600_000
const INTERRUPTED_SESSION_INDEX = 2
/** node, script path. */
const CLI_ARG_OFFSET = 2

const USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'openwaggle')
const PROJECT_ROOT = path.join(os.homedir(), 'Desktop', 'Projects', 'personal')

const args = process.argv.slice(CLI_ARG_OFFSET)
const messageCount = Number(args[args.indexOf('--messages') + 1] ?? String(DEFAULT_MESSAGE_COUNT))
const replaceQa = args.includes('--replace-qa')

/**
 * Each conversation has its own subject so the transcript on screen names the session that should
 * be open. A switch that fails to re-render is then visible rather than plausible.
 */
interface Conversation {
  readonly title: string
  readonly topic: string
  readonly lines: readonly string[]
}

const CONVERSATIONS: readonly Conversation[] = [
  {
    title: 'Kafka consumer lag investigation',
    topic: 'consumer lag',
    lines: [
      'The lag on partition 7 climbs to 40k during the nightly batch and never recovers on its own.',
      'Rebalances take 90 seconds because session.timeout.ms is still the default.',
      'Checked the broker: no disk pressure, so this is consumer side.',
      'Committing offsets synchronously in the handler is what serialises the whole poll loop.',
    ],
  },
  {
    title: 'CSS grid collapsing in Safari',
    topic: 'grid layout',
    lines: [
      'The sidebar grid collapses to a single column in Safari 17 but is correct in Chrome.',
      'min-content on the second track resolves differently once the row has an overflowing child.',
      'Replacing the implicit track with an explicit minmax(0, 1fr) fixes it.',
      'Worth checking whether the same bug affects the diff pane, which uses the same helper.',
    ],
  },
  {
    title: 'Rust borrow checker fight in the parser',
    topic: 'borrow checker',
    lines: [
      'The tokeniser holds a mutable borrow across the loop body, so the lookahead cannot read it.',
      'Splitting the cursor from the buffer removes the conflict without any unsafe code.',
      'Lifetime elision hides which reference the error is actually about.',
      'An index-based cursor is duller but compiles and benchmarks the same.',
    ],
  },
  {
    title: 'Postgres index not used by the report query',
    topic: 'query plan',
    lines: [
      'The composite index on (tenant_id, created_at) is ignored for the monthly report.',
      'EXPLAIN shows a sequential scan because created_at is wrapped in a date_trunc call.',
      'A functional index on date_trunc(month, created_at) restores the index scan.',
      'Statistics were also stale: last analyse ran before the bulk import.',
    ],
  },
  {
    title: 'Flaky end-to-end test in checkout',
    topic: 'test flake',
    lines: [
      'The checkout spec fails about one run in six, always on the payment step.',
      'The assertion races the spinner: it passes when the network is slow enough.',
      'Waiting on the settled request rather than a timeout removes the flake entirely.',
      'Ran it 200 times in a loop to confirm the rate dropped to zero.',
    ],
  },
  {
    title: 'Docker image size reduction',
    topic: 'image size',
    lines: [
      'The runtime image is 1.4GB because the build stage leaks into the final layer.',
      'A multi-stage build with a distroless base takes it to 180MB.',
      'The cache mount for the package manager saves four minutes per build.',
      'Copying only the built output keeps the source tree out of the published image.',
    ],
  },
  {
    title: 'Websocket reconnect storm',
    topic: 'reconnect storm',
    lines: [
      'Every client reconnects at the same instant after a deploy and overwhelms the gateway.',
      'The retry has no jitter, so the herd stays synchronised across attempts.',
      'Exponential backoff with full jitter spreads the reconnects over 30 seconds.',
      'A server-side cap on new connections per second is the backstop.',
    ],
  },
  {
    title: 'Accessibility audit of the settings dialog',
    topic: 'accessibility',
    lines: [
      'Focus escapes the dialog because the trap only listens for Tab, not Shift+Tab.',
      'The close control is an icon with no accessible name.',
      'Contrast on the helper text measures 3.1 to 1, below the 4.5 required.',
      'Escape closes the dialog but does not return focus to the control that opened it.',
    ],
  },
]

/** A transcript whose every line names its own subject. */
function buildMessages(conversation: Conversation, count: number) {
  const messages: unknown[] = []
  for (let i = 0; i < count; i += 1) {
    const role = i % ROLE_ALTERNATION === 0 ? 'user' : 'assistant'
    const line = conversation.lines[i % conversation.lines.length]
    const text =
      role === 'user'
        ? `[${conversation.topic} · turn ${i}] ${line}`
        : `[${conversation.topic} · turn ${i}] ${line} Here is the reasoning in more detail, repeated enough to give the transcript real weight. ${'Each paragraph adds a few lines so scrolling and mounting cost something measurable. '.repeat(PARAGRAPH_REPEATS)}`
    messages.push({
      id: `${conversation.topic.replace(/\s+/g, '-')}-${i}`,
      role,
      createdAt: Date.now() - (count - i) * ONE_MINUTE_MS,
      parts: [{ type: 'text', text }],
    })
  }
  return messages
}

function ensureGitProject(projectPath: string) {
  fs.mkdirSync(projectPath, { recursive: true })
  if (fs.existsSync(path.join(projectPath, '.git'))) return
  const git = (...a: string[]) => execFileSync('git', a, { cwd: projectPath, stdio: 'ignore' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'qa@example.com')
  git('config', 'user.name', 'QA')
  fs.writeFileSync(path.join(projectPath, 'README.md'), '# QA fixture project\n')
  git('add', '.')
  git('commit', '-m', 'initial')
}

function removeEmptyQaSessions() {
  const db = new DatabaseSync(path.join(USER_DATA_DIR, 'openwaggle.db'))
  db.exec('PRAGMA foreign_keys = ON')
  const empty = db
    .prepare(
      `SELECT s.id FROM sessions s
       LEFT JOIN session_nodes n ON n.session_id = s.id
       WHERE s.title LIKE 'QA session%'
       GROUP BY s.id HAVING COUNT(n.id) = 0`,
    )
    .all()
  for (const row of empty) {
    const id = String(row.id)
    for (const table of [
      'session_active_runs',
      'session_tree_ui_state',
      'session_branch_state',
      'session_branches',
      'session_nodes',
      'pinned_sessions',
      'turn_checkpoints',
    ]) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id)
      } catch {
        // Table may not carry session_id in every schema version.
      }
    }
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }
  db.close()
  console.log(`removed ${empty.length} empty QA session(s)`)
}

const projectA = path.join(PROJECT_ROOT, 'qa-fixture-alpha')
const projectB = path.join(PROJECT_ROOT, 'qa-fixture-beta')
ensureGitProject(projectA)
ensureGitProject(projectB)

if (replaceQa) removeEmptyQaSessions()

const seeds = CONVERSATIONS.map((conversation, index) => ({
  title: conversation.title,
  projectPath: index % ROLE_ALTERNATION === 0 ? projectA : projectB,
  updatedAt: Date.now() - index * ONE_HOUR_MS,
  messages: buildMessages(conversation, messageCount),
  // One session left mid-run, so the state chips and roll-up pips have something to report.
  ...(index === INTERRUPTED_SESSION_INDEX ? { interruptedRun: true } : {}),
}))

await seedSessions(USER_DATA_DIR, seeds)
console.log(
  `seeded ${seeds.length} sessions with ${messageCount} messages each into ${USER_DATA_DIR}`,
)
for (const seed of seeds) console.log(`  ${seed.title}`)
