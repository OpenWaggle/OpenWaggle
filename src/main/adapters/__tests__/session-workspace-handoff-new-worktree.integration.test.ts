import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { organizeSession } from '../../application/session-organization-service'
import { resolveFreshWorktreeBaseRef } from '../pi/agent-kernel/session-branch-freshness'
import { createGitWorktree } from '../git/worktree'
import { GitSessionWorkspaceHandoffServiceLive } from '../git-session-workspace-handoff-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

const execFileAsync = promisify(execFile)

/**
 * A Session's first send in worktree mode must fork from the base ref the user picked, and a
 * handoff to `new-worktree` is the only control that records that pick for a Session that
 * already exists. It used to capture a handoff seed for such a Session, which can only sit on
 * the source HEAD: picking any other branch was refused with `workspace_base_ref_mismatch`,
 * and the fallback recorded the checkout's HEAD commit as the base ref, so the worktree was
 * born from whatever the checkout had. These drive real Git and the real SQLite handoff.
 */
const IDENTITY = [
  '-c',
  'user.name=OpenWaggle Tests',
  '-c',
  'user.email=tests@openwaggle.ai',
] as const

let temporaryRoot = ''
let repositoryPath = ''

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFileAsync('git', [...IDENTITY, ...args], { cwd })
  return stdout.trim()
}

async function commitFile(file: string, contents: string, message: string) {
  await fs.writeFile(path.join(repositoryPath, file), contents, 'utf8')
  await git(repositoryPath, ['add', file])
  await git(repositoryPath, ['commit', '-m', message])
}

/** A checkout on `main` whose `feature` branch holds one commit `main` does not. */
async function createRepository() {
  repositoryPath = path.join(temporaryRoot, 'repository')
  await fs.mkdir(repositoryPath, { recursive: true })
  await git(repositoryPath, ['init', '-b', 'main'])
  // Repository-local identity: the app's own Git calls (a seed's commit-tree) read it.
  await git(repositoryPath, ['config', 'user.name', 'OpenWaggle Tests'])
  await git(repositoryPath, ['config', 'user.email', 'tests@openwaggle.ai'])
  await commitFile('base.txt', 'base\n', 'chore: baseline')
  await git(repositoryPath, ['checkout', '-b', 'feature'])
  await commitFile('feature.txt', 'feature\n', 'feat: work on the picked branch')
  await git(repositoryPath, ['checkout', 'main'])
  // Uncommitted state in the checkout: it belongs to the user, not to a Session that never ran.
  await fs.writeFile(path.join(repositoryPath, 'base.txt'), 'dirty\n', 'utf8')
}

function handoffRequest(sessionId: string, baseRef: string | undefined) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `${sessionId}-request`,
    idempotencyKey: `${sessionId}-key`,
    command: {
      operation: 'handoff',
      sessionId,
      workspace: {
        mode: 'new-worktree',
        ...(baseRef === undefined ? {} : { baseRef }),
      },
    },
  } as const
}

function insertLocalSession(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    /*
     * Only a node's existence is read, by the handoff's "does this Session have history" query,
     * so this fixture carries the two columns that decide it rather than the whole transcript
     * schema, which would collide with the `session_branches` sibling fixtures declare.
     */
    yield* sql.unsafe(`CREATE TABLE IF NOT EXISTS session_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
    )`)
    yield* sql`INSERT INTO sessions (id, project_path) VALUES (${sessionId}, ${repositoryPath})`
    yield* sql`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state,
        worktree_start_from_origin, created_at, updated_at
      ) VALUES (
        ${`workspace-${sessionId}`}, ${repositoryPath}, ${'local'}, ${repositoryPath},
        ${'ready'}, ${0}, ${1000}, ${1000}
      )
    `
    yield* sql`
      INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
      VALUES (${sessionId}, ${`workspace-${sessionId}`}, ${1000})
    `
    yield* sql`
      INSERT INTO session_control_states (
        session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
      ) VALUES (${sessionId}, ${0}, ${null}, ${'running'}, ${0}, ${1000})
    `
  })
}

function markSessionAsHavingRun(sql: SqlClient.SqlClient, sessionId: string) {
  return sql`
    INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
    VALUES (${`run-${sessionId}`}, ${sessionId}, ${'completed'}, ${1000}, ${1000})
  `
}

/** A Session the session-host cutover migrated: transcript nodes, no `session_runs` row. */
function markSessionAsMigratedWithHistory(sql: SqlClient.SqlClient, sessionId: string) {
  return sql`
    INSERT INTO session_nodes (id, session_id) VALUES (${`node-${sessionId}`}, ${sessionId})
  `
}

function boundWorkspace(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly kind: string
      readonly worktree_base_ref: string | null
      readonly handoff_seed_state: string
      readonly handoff_seed_ref: string | null
    }>`
      SELECT kind, worktree_base_ref, handoff_seed_state, handoff_seed_ref
      FROM workspace_resources
      WHERE id = (
        SELECT workspace_id FROM session_workspace_bindings WHERE session_id = ${sessionId}
      )
    `
    return rows[0]
  })
}

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-new-worktree-handoff-'))
  // The developer's own Git configuration must not decide these repositories.
  await fs.writeFile(path.join(temporaryRoot, 'gitconfig'), '')
  vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(temporaryRoot, 'gitconfig'))
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  await createRepository()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

describe('handing a Session to a new worktree', () => {
  it('records the picked base ref for a Session that never ran, without a seed', async () => {
    const layer = makeSessionControlTestLayer(
      path.join(temporaryRoot, 'never-ran.sqlite'),
      undefined,
      GitSessionWorkspaceHandoffServiceLive,
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertLocalSession(sql, 'session-fresh')
        const response = yield* organizeSession({
          callerId: 'caller',
          request: handoffRequest('session-fresh', 'feature'),
        })
        const workspace = yield* boundWorkspace(sql, 'session-fresh')
        const session = yield* sql<{ readonly worktree_base_ref: string | null }>`
          SELECT worktree_base_ref FROM sessions WHERE id = ${'session-fresh'}
        `
        return { response, workspace, session: session[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome.effect).toBe('session-handed-off')
    expect(result.workspace?.kind).toBe('managed-worktree')
    expect(result.workspace?.worktree_base_ref).toBe('feature')
    // The checkout's uncommitted edit is not the Session's work, so nothing is carried into a
    // worktree that isolation exists to keep separate from the user's tree.
    expect(result.workspace?.handoff_seed_state).toBe('none')
    expect(result.workspace?.handoff_seed_ref).toBeNull()
    expect(result.session?.worktree_base_ref).toBe('feature')
  })

  it('forks the new worktree from that recorded base ref', async () => {
    const layer = makeSessionControlTestLayer(
      path.join(temporaryRoot, 'birth.sqlite'),
      undefined,
      GitSessionWorkspaceHandoffServiceLive,
    )
    const featureHead = await git(repositoryPath, ['rev-parse', 'feature'])

    const recorded = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertLocalSession(sql, 'session-fresh')
        yield* organizeSession({
          callerId: 'caller',
          request: handoffRequest('session-fresh', 'feature'),
        })
        const workspace = yield* boundWorkspace(sql, 'session-fresh')
        return workspace
      }).pipe(Effect.provide(layer)),
    )
    const baseRef = recorded?.worktree_base_ref
    if (!baseRef) throw new Error('The handoff recorded no base ref.')

    const freshBase = await resolveFreshWorktreeBaseRef(
      { worktreeBaseRef: baseRef },
      repositoryPath,
    )
    const worktreePath = path.join(temporaryRoot, 'worktree')
    const created = await createGitWorktree(repositoryPath, {
      path: worktreePath,
      branch: 'ow/session-fresh',
      baseRef: freshBase ?? baseRef,
    })

    expect(created.ok).toBe(true)
    expect(await git(worktreePath, ['rev-parse', 'HEAD'])).toBe(featureHead)
    // The checkout's uncommitted edit stayed in the checkout.
    expect(await git(worktreePath, ['show', 'HEAD:base.txt'])).toBe('base')
  })

  it('keeps carrying uncommitted work for a migrated Session with no run row', async () => {
    const layer = makeSessionControlTestLayer(
      path.join(temporaryRoot, 'migrated.sqlite'),
      undefined,
      GitSessionWorkspaceHandoffServiceLive,
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertLocalSession(sql, 'session-migrated')
        yield* markSessionAsMigratedWithHistory(sql, 'session-migrated')
        yield* organizeSession({
          callerId: 'caller',
          request: handoffRequest('session-migrated', 'main'),
        })
        return yield* boundWorkspace(sql, 'session-migrated')
      }).pipe(Effect.provide(layer)),
    )

    expect(result?.handoff_seed_state).toBe('pending')
  })

  it('keeps carrying uncommitted work for a Session that already ran', async () => {
    const layer = makeSessionControlTestLayer(
      path.join(temporaryRoot, 'has-run.sqlite'),
      undefined,
      GitSessionWorkspaceHandoffServiceLive,
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertLocalSession(sql, 'session-used')
        yield* markSessionAsHavingRun(sql, 'session-used')
        yield* organizeSession({
          callerId: 'caller',
          request: handoffRequest('session-used', 'main'),
        })
        return yield* boundWorkspace(sql, 'session-used')
      }).pipe(Effect.provide(layer)),
    )

    // A seed can only sit on the source HEAD, so that is what the plan pins.
    expect(result?.handoff_seed_state).toBe('pending')
    expect(result?.handoff_seed_ref).not.toBeNull()
    expect(result?.worktree_base_ref).toBe(await git(repositoryPath, ['rev-parse', 'HEAD']))
  })

  it('refuses a different base ref when a ran Session has uncommitted work to carry', async () => {
    const layer = makeSessionControlTestLayer(
      path.join(temporaryRoot, 'refused.sqlite'),
      undefined,
      GitSessionWorkspaceHandoffServiceLive,
    )

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* insertLocalSession(sql, 'session-used')
        yield* markSessionAsHavingRun(sql, 'session-used')
        return yield* organizeSession({
          callerId: 'caller',
          request: handoffRequest('session-used', 'feature'),
        })
      }).pipe(Effect.provide(layer)),
    )

    // A structured refusal the caller can present, not a host error: the pick cannot be
    // honoured because the uncommitted work can only be carried onto its own HEAD.
    expect(response.outcome.effect).toBe('rejected')
    expect(response.outcome).toMatchObject({ code: 'workspace_base_ref_mismatch' })
  })
})
