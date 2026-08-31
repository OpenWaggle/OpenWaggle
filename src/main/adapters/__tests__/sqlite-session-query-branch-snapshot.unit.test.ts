import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session query branch snapshots', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-query-snapshot-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each([{ branchId: 'worker:branch:main' }, { snapshotHeadNodeId: 'node-worker-2' }])(
    'rejects supplied branch snapshot state on a tree item read',
    async (snapshot) => {
      const runtime = makeRuntime(path.join(temporaryRoot, 'tree-snapshot.sqlite'))
      runtimes.push(runtime)
      const result = await executeQuery(runtime, {
        operation: 'items',
        sessionId: 'worker',
        branchScope: 'tree',
        ...snapshot,
        limit: 10,
      })

      expect(result.outcome).toMatchObject({ error: { code: 'branch_not_found' } })
    },
  )
})
