import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session Run query', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-turn-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('pages stable Run summaries with their exact attributed node bounds', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'turns.sqlite'))
    runtimes.push(runtime)
    const first = await executeQuery(runtime, {
      operation: 'turns',
      sessionId: 'worker',
      limit: 1,
    })
    if (first.outcome.operation !== 'turns' || !('turns' in first.outcome)) {
      throw new Error('Expected turns outcome.')
    }
    const second = await executeQuery(runtime, {
      operation: 'turns',
      sessionId: 'worker',
      limit: 1,
      cursor: first.outcome.nextCursor,
    })

    expect(first.outcome).toMatchObject({
      turns: [
        {
          runId: 'run-worker',
          status: 'completed',
          nodeCount: 1,
          firstCreatedOrder: 0,
          lastCreatedOrder: 0,
        },
      ],
    })
    expect(second.outcome).toMatchObject({
      turns: [{ runId: 'run-worker-2', status: 'interrupted', nodeCount: 1 }],
    })
  })
})
