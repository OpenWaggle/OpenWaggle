import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, persistSessionSnapshot } from '../../../../store/session-details'
import { retainedSnapshotNodeIds } from '../../../../store/session-details/retained-snapshot-nodes'
import { runStoreEffect } from '../../../../store/store-runtime'
import { PI_ENTRY_PROJECTION_VERSION } from '../entry-projection-version'
import { readRunProjectionBase } from '../run-projection-base'
import { projectPiSessionSnapshot } from '../session-projection'

/**
 * A Run's snapshot keeps the entries the Session's current projection already holds, when the Pi
 * file only grew since it (D6), and projects the rest. Whatever it keeps, the snapshot and the
 * saved rows must be exactly what projecting every entry again gives.
 */

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '', root: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const CWD = '/tmp/tail-projection'
const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-tail-projection-'))
  state.userDataDir = path.join(state.root, 'user-data')
  mkdirSync(state.userDataDir, { recursive: true })
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.root, { recursive: true, force: true })
})

function prompt(manager: SessionManager, text: string) {
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: 1 })
}

function answer(manager: SessionManager, text: string) {
  return manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: 2,
  })
}

async function startSession() {
  const manager = SessionManager.create(CWD, path.join(state.root, 'sessions'))
  const session = await createSession({ projectPath: CWD, piSessionId: manager.getSessionId() })
  const sessionId = SessionId(String(session.id))
  return { manager, session: { id: sessionId }, sessionId }
}

function persist(
  sessionId: SessionId,
  manager: SessionManager,
  snapshot: ReturnType<typeof projectPiSessionSnapshot>,
) {
  return persistSessionSnapshot({
    sessionId,
    piSessionId: manager.getSessionId(),
    piSessionFile: manager.getSessionFile(),
    activeNodeId: snapshot.activeNodeId,
    nodes: snapshot.nodes,
    piProjection: snapshot.piProjection,
  })
}

function readRows(sessionId: SessionId) {
  return runStoreEffect(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        SELECT id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
          metadata_json, content_hash, branch_hint_id, path_depth, created_order
        FROM session_nodes WHERE session_id = ${sessionId} ORDER BY created_order
      `,
    ),
  )
}

/** A Session with three answered prompts, projected and saved in full. */
async function projectedSession() {
  const started = await startSession()
  const { manager, sessionId } = started
  prompt(manager, 'first question')
  const firstAnswer = answer(manager, 'first answer')
  prompt(manager, 'second question')
  answer(manager, 'second answer')
  prompt(manager, 'third question')
  answer(manager, 'third answer')
  await persist(sessionId, manager, projectPiSessionSnapshot({ sessionManager: manager }))
  return { ...started, firstAnswer, file: manager.getSessionFile() ?? '' }
}

describe('a Run snapshot keeps the entries its Session already projected', () => {
  it('projects only what Pi appended, and equals projecting every entry', async () => {
    const { manager, session, sessionId, firstAnswer, file } = await projectedSession()
    const projectedCount = manager.getEntries().length
    // A context edit drops an answer the projection already holds; a branch moves the leaf.
    manager.appendContextEdit(firstAnswer, null)
    prompt(manager, 'fourth question')
    answer(manager, 'fourth answer')

    const base = await readRunProjectionBase(session, file)
    expect(base?.tail.entryCount).toBe(projectedCount)
    const kept = projectPiSessionSnapshot({ sessionManager: manager }, undefined, base)
    const full = projectPiSessionSnapshot({ sessionManager: manager })

    const keptIds = retainedSnapshotNodeIds(kept.nodes, base?.revision ?? -1)
    // Every projected entry but the answer the context edit dropped is kept.
    expect(keptIds.size).toBe(projectedCount - 1)
    expect(keptIds.has(firstAnswer)).toBe(false)
    expect(JSON.stringify(kept)).toBe(JSON.stringify(full))

    await persist(sessionId, manager, kept)
    const afterKept = await readRows(sessionId)
    await persist(sessionId, manager, projectPiSessionSnapshot({ sessionManager: manager }))
    expect(await readRows(sessionId)).toEqual(afterKept)
  })

  it('keeps the tree up to date for kept entries when a branch is added', async () => {
    const { manager, session, sessionId, firstAnswer, file } = await projectedSession()
    manager.branch(firstAnswer)
    prompt(manager, 'a question on a new branch')
    answer(manager, 'an answer on a new branch')

    const base = await readRunProjectionBase(session, file)
    const kept = projectPiSessionSnapshot({ sessionManager: manager }, undefined, base)
    expect(retainedSnapshotNodeIds(kept.nodes, base?.revision ?? -1).size).toBeGreaterThan(0)
    await persist(sessionId, manager, kept)
    const afterKept = await readRows(sessionId)
    await persist(sessionId, manager, projectPiSessionSnapshot({ sessionManager: manager }))
    expect(await readRows(sessionId)).toEqual(afterKept)
  })

  it('keeps nothing from a projection another entry-projection version stored', async () => {
    const { manager, session, sessionId, firstAnswer, file } = await projectedSession()
    prompt(manager, 'fourth question')
    const current = await readRunProjectionBase(session, file)
    expect(current?.tail.projectionVersion).toBe(PI_ENTRY_PROJECTION_VERSION)
    // The rows were stored by the code before a change to how entries are projected.
    await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`
          UPDATE pi_session_file_projections
          SET tail_projection_version = ${PI_ENTRY_PROJECTION_VERSION - 1}
          WHERE session_id = ${sessionId}
        `,
      ),
    )
    const older = await readRunProjectionBase(session, file)
    expect(older?.tail.projectionVersion).toBe(PI_ENTRY_PROJECTION_VERSION - 1)
    const snapshot = projectPiSessionSnapshot({ sessionManager: manager }, undefined, older)
    expect(retainedSnapshotNodeIds(snapshot.nodes, older?.revision ?? -1).size).toBe(0)

    // Saving it repairs a stored row the older code got wrong.
    await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`
          UPDATE session_nodes SET metadata_json = ${'{"stale":true}'}
          WHERE id = ${firstAnswer}
        `,
      ),
    )
    await persist(sessionId, manager, snapshot)
    const rows = await readRows(sessionId)
    expect(rows.find((row) => row.id === firstAnswer)?.metadata_json).toBe(
      projectPiSessionSnapshot({ sessionManager: manager }).nodes.find(
        (node) => node.id === firstAnswer,
      )?.metadataJson,
    )
  })

  it('keeps nothing from a snapshot saved without its projection version', async () => {
    const { manager, session, sessionId, file } = await projectedSession()
    const { piProjection: _version, ...unversioned } = projectPiSessionSnapshot({
      sessionManager: manager,
    })
    await persistSessionSnapshot({
      sessionId,
      piSessionId: manager.getSessionId(),
      piSessionFile: file,
      ...unversioned,
    })
    prompt(manager, 'fourth question')
    const base = await readRunProjectionBase(session, file)
    expect(base?.tail.projectionVersion).toBeNull()
    const snapshot = projectPiSessionSnapshot({ sessionManager: manager }, undefined, base)
    expect(retainedSnapshotNodeIds(snapshot.nodes, base?.revision ?? -1).size).toBe(0)
  })

  it('keeps nothing once the file was rewritten, as an upgrade by pi --resume does', async () => {
    const { manager, session, file } = await projectedSession()
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
    const header = JSON.parse(lines[0] ?? '{}')
    writeFileSync(
      file,
      `${[JSON.stringify({ ...header, cwd: `${CWD}-x` }), ...lines.slice(1)].join('\n')}\n`,
    )
    prompt(manager, 'after the rewrite')

    expect(await readRunProjectionBase(session, file)).toBeNull()
  })

  it('keeps nothing once the file shrank', async () => {
    const { session, file } = await projectedSession()
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
    writeFileSync(file, `${lines.slice(0, -1).join('\n')}\n`)

    expect(await readRunProjectionBase(session, file)).toBeNull()
  })

  it('keeps nothing when the last projected entry was renamed in place', async () => {
    const { session, file } = await projectedSession()
    const content = readFileSync(file, 'utf8')
    const lines = content.trimEnd().split('\n')
    const last = JSON.parse(lines.at(-1) ?? '{}')
    lines[lines.length - 1] = JSON.stringify({ ...last, id: 'renamed-entry-id' })
    writeFileSync(file, `${lines.join('\n')}\n`)

    expect(await readRunProjectionBase(session, file)).toBeNull()
  })

  it('does not trust kept entries once another snapshot was saved after the base was read', async () => {
    const { manager, session, sessionId, file } = await projectedSession()
    const base = await readRunProjectionBase(session, file)
    prompt(manager, 'fourth question')
    answer(manager, 'fourth answer')
    // Another snapshot lands first, and leaves a stored node unlike the projection.
    await persist(sessionId, manager, projectPiSessionSnapshot({ sessionManager: manager }))
    const firstNodeId = manager.getEntries()[0]?.id ?? ''
    await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`
          UPDATE session_nodes SET content_json = ${'{"parts":[]}'}, content_hash = ${'stale'}
          WHERE id = ${firstNodeId}
        `,
      ),
    )

    await persist(
      sessionId,
      manager,
      projectPiSessionSnapshot({ sessionManager: manager }, undefined, base),
    )
    const rows = await readRows(sessionId)
    const full = projectPiSessionSnapshot({ sessionManager: manager })
    expect(rows.find((row) => row.id === firstNodeId)?.content_json).toBe(
      full.nodes.find((node) => node.id === firstNodeId)?.contentJson,
    )
  })
})
