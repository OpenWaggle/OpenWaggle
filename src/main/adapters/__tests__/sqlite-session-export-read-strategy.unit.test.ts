import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportNodeReadStrategy } from '../sqlite-session-export-node-reader'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session export node reads', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-node-read-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('uses the branch-hint cursor index for the active branch head only', () => {
    expect(
      exportNodeReadStrategy({
        tree: false,
        selectedBranchId: 'branch-active',
        activeBranchId: 'branch-active',
        selectedHeadNodeId: 'node-head',
        branchHeadNodeId: 'node-head',
      }),
    ).toBe('indexed-active-branch')
    expect(
      exportNodeReadStrategy({
        tree: false,
        selectedBranchId: 'branch-pinned',
        activeBranchId: 'branch-active',
        selectedHeadNodeId: 'node-head',
        branchHeadNodeId: 'node-head',
      }),
    ).toBe('recursive-branch')
    expect(
      exportNodeReadStrategy({
        tree: false,
        selectedBranchId: 'branch-active',
        activeBranchId: 'branch-active',
        selectedHeadNodeId: 'node-ancestor',
        branchHeadNodeId: 'node-head',
      }),
    ).toBe('recursive-branch')
    expect(
      exportNodeReadStrategy({
        tree: true,
        selectedBranchId: null,
        activeBranchId: 'branch-active',
        selectedHeadNodeId: null,
        branchHeadNodeId: null,
      }),
    ).toBe('tree')
  })

  it('keeps an ancestor snapshot head from exporting later active-branch descendants', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'export-ancestor-head.sqlite'))
    runtimes.push(runtime)

    const result = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      limit: 10,
      branchScope: 'active-branch',
      snapshotHeadNodeId: 'node-worker-1',
    })

    if (result.outcome.operation !== 'export' || !('records' in result.outcome)) {
      throw new Error('Expected export outcome.')
    }
    expect(result.outcome.records.map((record) => record.nodeId)).toEqual(['node-worker-1'])
  })

  it('rejects supplied snapshot heads outside the selected existing branch', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'export-branch-binding.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-worker-fork'}, ${'worker'}, ${'node-worker-1'}, ${'message'}, ${'assistant'},
            ${3}, ${'{"text":"fork-only"}'}, ${'{}'}, ${'worker:branch:fork'}, ${2}
          )
        `
        yield* sql`
          INSERT INTO session_branches (id, session_id, head_node_id)
          VALUES (${'worker:branch:fork'}, ${'worker'}, ${'node-worker-fork'})
        `
      }),
    )

    const missingBranch = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: 'worker:branch:missing',
      snapshotHeadNodeId: 'node-worker-2',
      limit: 10,
    })
    const mismatchedHead = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      branchScope: 'active-branch',
      branchId: 'worker:branch:main',
      snapshotHeadNodeId: 'node-worker-fork',
      limit: 10,
    })

    expect(missingBranch.outcome).toMatchObject({ error: { code: 'branch_not_found' } })
    expect(mismatchedHead.outcome).toMatchObject({ error: { code: 'branch_not_found' } })
  })
})
