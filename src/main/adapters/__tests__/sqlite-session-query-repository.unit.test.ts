import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session query repository', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('lists flat Sessions with Queen and Worker lineage metadata', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'list.sqlite'))
    runtimes.push(runtime)
    const result = await executeQuery(runtime, { operation: 'list', limit: 10 })

    expect(result.outcome).toMatchObject({
      operation: 'list',
      sessions: [
        { sessionId: 'queen', lineageRole: 'queen', directWorkerCount: 1 },
        {
          sessionId: 'worker',
          lineageRole: 'worker',
          parentSessionId: 'queen',
          agentDefinitionName: 'reviewer',
          delegationId: 'delegation-worker',
          delegationState: 'ready_for_review',
        },
        { sessionId: 'other', lineageRole: 'independent' },
      ],
    })
  })

  it('reads the Worker Delegation identity and authoritative lifecycle state', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'read-delegation.sqlite'))
    runtimes.push(runtime)
    const result = await executeQuery(runtime, { operation: 'read', sessionId: 'worker' })

    expect(result.outcome).toMatchObject({
      operation: 'read',
      session: {
        sessionId: 'worker',
        delegationId: 'delegation-worker',
        delegationState: 'ready_for_review',
      },
      runtime: { stateRevision: 0, activeRunId: null },
      queue: { state: 'running', revision: 0, pendingCount: 1 },
      delegation: {
        delegationId: 'delegation-worker',
        state: 'ready_for_review',
        currentSpecificationRevision: 1,
        latestSubmissionRevision: 1,
      },
    })
  })

  it('lists and reads Delegation contracts without hydrating linked transcripts', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'delegations.sqlite'))
    runtimes.push(runtime)
    const listed = await executeQuery(runtime, {
      operation: 'delegations-list',
      limit: 10,
      parentSessionId: 'queen',
      states: ['ready_for_review'],
    })
    const read = await executeQuery(runtime, {
      operation: 'delegations-read',
      delegationId: 'delegation-worker',
    })

    expect(listed.outcome).toMatchObject({
      operation: 'delegations-list',
      delegations: [
        {
          delegationId: 'delegation-worker',
          workerSessionId: 'worker',
          objective: 'Validate migration',
          latestSubmissionRevision: 1,
        },
      ],
    })
    expect(read.outcome).toMatchObject({
      operation: 'delegations-read',
      delegation: { delegationId: 'delegation-worker', state: 'ready_for_review' },
      specifications: [{ revision: 1, specification: { objective: 'Validate migration' } }],
      submissions: [
        {
          revision: 1,
          provenance: 'agent-submitted',
          evidence: [{ kind: 'observed-command', summary: 'Tests passed.' }],
        },
      ],
      claimRevisions: [
        {
          revision: 1,
          reason: 'Editing the migration.',
          claims: [{ access: 'write', target: { type: 'workspace-tree', path: 'src/main' } }],
        },
      ],
      undeclaredWrites: [
        {
          workerSessionId: 'worker',
          runId: 'run-worker',
          path: 'website/package.json',
          claimRevision: 1,
          provenance: 'isolated-turn-checkpoint',
        },
      ],
    })
    expect(JSON.stringify(read)).not.toContain('neural handshake verifier')
  })

  it('omits linked conflict evidence when only one Worker is in the caller scope', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'delegation-conflict-scope.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO delegation_contracts (
            id, parent_session_id, child_session_id, state,
            current_specification_revision, created_at, updated_at
          ) VALUES (
            ${'delegation-other'}, ${'other'}, ${'other'}, ${'working'}, ${1}, ${1}, ${2}
          )
        `
        yield* sql`
          INSERT INTO delegation_specifications (
            delegation_id, revision, specification_json, authored_by, created_at
          ) VALUES (
            ${'delegation-other'}, ${1},
            ${'{"objective":"Private work","deliverables":[],"acceptanceCriteria":[],"resourceReferences":[]}'},
            ${'other'}, ${1}
          )
        `
        yield* sql`
          INSERT INTO delegation_conflicts (
            id, left_delegation_id, right_delegation_id, kind, evidence_json, created_at
          ) VALUES (
            ${'conflict-private-peer'}, ${'delegation-worker'}, ${'delegation-other'},
            ${'live-overlap'}, ${'{"secret":"private evidence"}'}, ${3}
          )
        `
      }),
    )
    const read = await executeQuery(
      runtime,
      { operation: 'delegations-read', delegationId: 'delegation-worker' },
      {
        profileId: 'profile-a',
        profileName: 'a',
        capabilities: ['delegations:read'],
        scope: { projectPaths: ['/project-a'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )

    expect(read.outcome).toMatchObject({ operation: 'delegations-read', conflicts: [] })
    expect(JSON.stringify(read)).not.toContain('private evidence')
  })

  it('filters the default catalog by exact bound Working path', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'working-path.sqlite'))
    runtimes.push(runtime)
    const result = await executeQuery(runtime, {
      operation: 'list',
      limit: 10,
      workingPath: '/project-b',
    })

    expect(result.outcome).toMatchObject({
      operation: 'list',
      sessions: [{ sessionId: 'other' }],
    })
  })

  it('indexes bounded discovery text and gates full transcript FTS behind explicit scope', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'search.sqlite'))
    runtimes.push(runtime)
    const discovery = await executeQuery(runtime, {
      operation: 'search',
      query: 'neural handshake',
      limit: 10,
    })
    const allowed = await executeQuery(
      runtime,
      {
        operation: 'search',
        query: 'neural handshake',
        searchScope: 'full-transcript',
        limit: 10,
      },
      {
        profileId: 'profile-a',
        profileName: 'a',
        capabilities: ['sessions:discover'],
        scope: { projectPaths: ['/project-a'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )
    const denied = await executeQuery(
      runtime,
      {
        operation: 'search',
        query: 'neural handshake',
        searchScope: 'full-transcript',
        limit: 10,
      },
      {
        profileId: 'profile-b',
        profileName: 'b',
        capabilities: ['sessions:discover'],
        scope: { projectPaths: ['/project-b'] },
        authorizationCeiling: 'ask-for-approval',
      },
    )
    const objective = await executeQuery(runtime, {
      operation: 'search',
      query: 'Validate migration',
      limit: 10,
    })
    const currentPreview = await executeQuery(runtime, {
      operation: 'search',
      query: 'second page',
      limit: 10,
    })
    expect(discovery.outcome).toMatchObject({ operation: 'search', sessions: [] })
    expect(allowed.outcome).toMatchObject({
      operation: 'search',
      searchBackend: 'lexical',
      requestedSearchMode: 'lexical',
      sessions: [
        {
          sessionId: 'worker',
          discoveryEvidence: {
            matchedFields: ['transcript'],
            transcriptMatch: {
              nodeId: 'node-worker-1',
              runId: 'run-worker',
              createdOrder: 0,
            },
          },
        },
      ],
    })
    expect(denied.outcome).toMatchObject({ operation: 'search', sessions: [] })
    expect(objective.outcome).toMatchObject({
      operation: 'search',
      sessions: [{ sessionId: 'worker' }],
    })
    expect(currentPreview.outcome).toMatchObject({
      operation: 'search',
      sessions: [{ sessionId: 'worker' }],
    })
  })

  it('keeps discovery search hybrid by default', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'default-search-mode.sqlite'))
    runtimes.push(runtime)

    const result = await executeQuery(runtime, {
      operation: 'search',
      query: 'Validate migration',
      limit: 10,
    })

    expect(result.outcome).toMatchObject({
      operation: 'search',
      requestedSearchMode: 'hybrid',
    })
  })
})
