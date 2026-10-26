import { seedHive, type SeedHiveWorkerInput } from './support/session-fixtures'
import type { ScreenshotProject } from './website-screenshot-project'

export const HIVE_QUEEN_TITLE = 'Prepare the 1.0 release'
export const HIVE_STUCK_WORKER_TITLE = 'Verify queue and steering behavior'
export const HIVE_NESTED_WORKER_TITLE = "Check the guide's screenshots"

const MINUTE_MS = 60_000
const QUEEN_USER_OFFSET_MS = 30 * MINUTE_MS
const QUEEN_TOOLS_OFFSET_MS = 29 * MINUTE_MS
const QUEEN_REPLY_OFFSET_MS = 28 * MINUTE_MS
const WEB_SEARCH_DURATION_MS = 1_840
const READ_DURATION_MS = 42

type HiveWorkerFixture = Omit<SeedHiveWorkerInput, 'projectPath' | 'updatedAt' | 'messages'> & {
  /** Index into the project's managed worktrees, for a Worker that works in one. */
  readonly worktreeIndex?: number
}

/**
 * One Worker per "who acts next" group (ADR 0059), plus one a Worker spawned, so the tree has a
 * second level: Needs you (stuck: its Run failed and the idle Queen will not pick it up),
 * Waiting for Queen, Waiting for the Worker that spawned one, Working, Closed, and Archived.
 */
const HIVE_WORKERS: readonly HiveWorkerFixture[] = [
  {
    title: HIVE_STUCK_WORKER_TITLE,
    delegationState: 'needs_attention',
    attentionCause: 'run_failed',
    agentDefinitionName: 'release-verifier',
    worktreeIndex: 0,
  },
  { title: 'Check CLI and GUI synchronization', delegationState: 'ready_for_review' },
  { title: 'Review the Hive user guide', delegationState: 'working', worktreeIndex: 1 },
  { title: HIVE_NESTED_WORKER_TITLE, delegationState: 'waiting', parentWorkerIndex: 2 },
  { title: 'Summarize open security advisories', delegationState: 'accepted' },
  { title: 'Draft the migration notes', delegationState: 'cancelled', archived: true },
]

/** The groups the Hive panel's By next actor view shows for this fixture, in order. */
export const HIVE_NEXT_ACTOR_GROUPS = [
  'Needs you',
  'Waiting for Queen',
  'Waiting for Review the Hive user guide',
  'Working',
  'Closed',
] as const

export function hiveWorkerFixtures() {
  return HIVE_WORKERS
}

/**
 * The Queen's transcript also feeds Sources & outputs: a link the user gave, a web search and a
 * file the agent read (Sources), and a preview image it produced (Outputs).
 */
function buildQueenMessages(now: number, project: ScreenshotProject) {
  return [
    {
      id: 'website-hive-user-1',
      role: 'user',
      createdAt: now - QUEEN_USER_OFFSET_MS,
      parts: [
        {
          type: 'text',
          text: [
            'Create a Hive to prepare the 1.0 release. Delegate queue semantics, CLI synchronization, and the user guide review to separate Workers.',
            '',
            'Follow the [release checklist](https://openwaggle.ai/docs/developer-guide/contributing) and draft a preview of the release notes page.',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'website-hive-assistant-1',
      role: 'assistant',
      model: 'gpt-5.4',
      createdAt: now - QUEEN_TOOLS_OFFSET_MS,
      parts: [
        {
          type: 'tool-call',
          toolCall: {
            id: 'website-hive-search',
            name: 'web_search',
            args: { query: 'Electron 43 release notes' },
          },
        },
        {
          type: 'tool-result',
          toolResult: {
            id: 'website-hive-search',
            name: 'web_search',
            args: { query: 'Electron 43 release notes' },
            result: 'Electron 43.0.0 release notes: https://releases.electronjs.org/release/v43.0.0',
            isError: false,
            duration: WEB_SEARCH_DURATION_MS,
          },
        },
        {
          type: 'tool-call',
          toolCall: { id: 'website-hive-read', name: 'read', args: { path: 'README.md' } },
        },
        {
          type: 'tool-result',
          toolResult: {
            id: 'website-hive-read',
            name: 'read',
            args: { path: 'README.md' },
            result: '# OpenWaggle screenshot fixture',
            isError: false,
            duration: READ_DURATION_MS,
          },
        },
      ],
    },
    {
      id: 'website-hive-assistant-2',
      role: 'assistant',
      model: 'gpt-5.4',
      createdAt: now - QUEEN_REPLY_OFFSET_MS,
      parts: [
        {
          type: 'text',
          text: [
            'The Hive is running with four Worker Sessions:',
            '',
            '- Queue and steering verification failed its last Run and needs you.',
            '- CLI and GUI synchronization is ready for my review.',
            '- The Hive user guide review is in progress, with a Worker of its own checking the screenshots.',
            '- The security advisories summary is accepted.',
            '',
            `Here is a first preview of the release notes page:\n\n![Release notes preview](${project.outputImagePath})`,
          ].join('\n'),
        },
      ],
    },
  ]
}

export async function seedHiveExample(userDataDir: string, project: ScreenshotProject) {
  console.info('[website-shots] seeding Hive example')
  const now = Date.now()
  return seedHive(
    userDataDir,
    {
      title: HIVE_QUEEN_TITLE,
      projectPath: project.projectPath,
      updatedAt: now,
      messages: buildQueenMessages(now, project),
    },
    HIVE_WORKERS.map(({ worktreeIndex, ...worker }, index) => {
      const worktree = worktreeIndex === undefined ? undefined : project.worktrees[worktreeIndex]
      return {
        ...worker,
        projectPath: project.projectPath,
        updatedAt: now - (index + 1) * MINUTE_MS,
        messages: [],
        ...(worktree ? { environmentMode: 'worktree' as const, worktreePath: worktree.path } : {}),
      }
    }),
  )
}
