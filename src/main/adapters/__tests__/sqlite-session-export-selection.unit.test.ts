import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeSessionQuery, makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Session export selection', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime> | undefined

  afterEach(async () => {
    await runtime?.dispose()
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('rejects a branch selector instead of silently widening it to the full tree', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-selection-'))
    runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'selection.sqlite'))

    const response = await executeSessionQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      limit: 10,
      branchScope: 'tree',
      branchId: 'worker:branch:main',
    })

    expect(response.outcome).toMatchObject({
      operation: 'export',
      error: { code: 'branch_not_found', message: expect.stringContaining('active-branch') },
    })
  })
})
