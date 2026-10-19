import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { archiveSession, createSession, persistSessionSnapshot } from '../session-details'
import { runStoreEffect } from '../store-runtime'

/** Points the Electron mock's user data directory at a fresh store, then resets the runtime. */
export async function openArchivedItemsStore(state: { userDataDir: string }) {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-archived-items-'),
  )
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
}

export async function closeArchivedItemsStore(state: { userDataDir: string }) {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(state.userDataDir, { recursive: true, force: true })
}

function messageNode(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  text: string,
  order: number,
): ProjectedSessionNodeInput {
  return {
    id,
    parentId,
    piEntryType: 'message',
    kind: role === 'user' ? 'user_message' : 'assistant_message',
    role,
    timestampMs: order + 1,
    contentJson: JSON.stringify({
      parts: [{ type: 'text', text }],
      model: role === 'user' ? null : 'openai/gpt-5.4',
    }),
    metadataJson: '{}',
    pathDepth: order,
    createdOrder: order,
  }
}

function runSql<A>(run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>) {
  return runStoreEffect(Effect.flatMap(SqlClient.SqlClient, run))
}

export interface SeedSessionInput {
  readonly key: string
  readonly title: string
  readonly projectPath: string
  readonly transcript: readonly string[]
}

/** A session with a linear transcript of alternating user and assistant messages. */
export async function seedSession(input: SeedSessionInput) {
  const piSessionId = `pi-${input.key}`
  const session = await createSession({
    projectPath: input.projectPath,
    piSessionId,
    piSessionFile: `/tmp/${piSessionId}.jsonl`,
  })
  const sessionId = SessionId(String(session.id))
  const nodes = input.transcript.map((text, index) =>
    messageNode(
      `${input.key}-node-${String(index)}`,
      index === 0 ? null : `${input.key}-node-${String(index - 1)}`,
      index % 2 === 0 ? 'user' : 'assistant',
      text,
      index,
    ),
  )
  if (nodes.length > 0) {
    await persistSessionSnapshot({
      sessionId,
      piSessionId,
      piSessionFile: `/tmp/${piSessionId}.jsonl`,
      activeNodeId: nodes.at(-1)?.id ?? null,
      nodes,
    })
  }
  await runSql((sql) => sql`UPDATE sessions SET title = ${input.title} WHERE id = ${sessionId}`)
  return sessionId
}

/** Archives the session, then sets its archive time to `archivedAt` for deterministic order. */
export async function archiveSeededSession(sessionId: SessionId, archivedAt: number) {
  await archiveSession(sessionId)
  await runSql(
    (sql) => sql`UPDATE sessions SET archived_at = ${archivedAt} WHERE id = ${sessionId}`,
  )
}

/** A session whose second branch forks off its first message, so it can be archived alone. */
export async function seedSessionWithBranch(input: {
  readonly key: string
  readonly title: string
  readonly projectPath: string
}) {
  const piSessionId = `pi-${input.key}`
  const session = await createSession({
    projectPath: input.projectPath,
    piSessionId,
    piSessionFile: `/tmp/${piSessionId}.jsonl`,
  })
  const sessionId = SessionId(String(session.id))
  await persistSessionSnapshot({
    sessionId,
    piSessionId,
    piSessionFile: `/tmp/${piSessionId}.jsonl`,
    activeNodeId: 'branch-assistant',
    nodes: [
      messageNode('root-user', null, 'user', 'Start migration plan', 0),
      messageNode('main-assistant', 'root-user', 'assistant', 'Use the main path', 1),
      { ...messageNode('branch-user', 'root-user', 'user', 'Try branch path', 2), pathDepth: 1 },
      {
        ...messageNode('branch-assistant', 'branch-user', 'assistant', 'Branch response', 3),
        pathDepth: 2,
      },
    ],
  })
  await runSql((sql) => sql`UPDATE sessions SET title = ${input.title} WHERE id = ${sessionId}`)
  return sessionId
}

export async function readSessionArchiveColumns(sessionId: SessionId) {
  const rows = await runSql(
    (sql) => sql<{ readonly archived: number; readonly archived_at: number | null }>`
      SELECT archived, archived_at FROM sessions WHERE id = ${sessionId}
    `,
  )
  return rows[0]
}

export async function setBranchArchivedAt(branchId: string, archivedAt: number) {
  await runSql(
    (sql) => sql`UPDATE session_branches SET archived_at = ${archivedAt} WHERE id = ${branchId}`,
  )
}

export { runSql }
