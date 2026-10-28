import { describe, expect, it } from 'vitest'
import type { FakeProviderRequest, StreamWriter } from '../perf/lib/fake-openai-provider'
import { createScriptedHive } from '../perf/lib/scripted-hive'

const WORKERS = 5

function request(system: string, user: string): FakeProviderRequest {
  return {
    body: {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    rawLength: 0,
    receivedAt: 0,
  }
}

function recorder() {
  const calls: { readonly name: string; readonly arguments: object }[][] = []
  const stream: StreamWriter = {
    text: () => undefined,
    toolCalls: (batch) => {
      calls.push([...batch])
    },
    end: () => undefined,
  }
  return { calls, stream }
}

const COMPACT_WORKER_IDENTITY = '{"sessionId":"worker-1","parentSessionId":"queen","hiveDepth":1}'
const INDENTED_WORKER_IDENTITY = '{\n  "sessionId": "worker-1",\n  "parentSessionId": "queen"\n}'
const FIRST_WORKER_RUN = '{\n  "sessionTitle": "Memory Worker 1",\n  "hiveRole": "Worker"\n}'
const OTHER_WORKER_RUN = '{\n  "sessionTitle": "Memory Worker 2",\n  "hiveRole": "Worker"\n}'

describe('scripted Hive', () => {
  it('spawns four Workers from the Queen', async () => {
    const hive = createScriptedHive({ workers: WORKERS, sleepSeconds: 1, model: 'perf-local/perf-model' })
    const { calls, stream } = recorder()
    await hive.respond(request('{"sessionId":"queen","hiveDepth":0}', 'Spawn.'), stream)
    expect(calls[0]?.map((call) => call.name)).toEqual(['hive', 'hive', 'hive', 'hive'])
  })

  it.each([
    ['compact', COMPACT_WORKER_IDENTITY],
    ['indented', INDENTED_WORKER_IDENTITY],
  ])('recognizes a Worker from a %s Session identity', async (_format, identity) => {
    const hive = createScriptedHive({ workers: WORKERS, sleepSeconds: 1, model: 'perf-local/perf-model' })
    const first = recorder()
    await hive.respond(request(identity, FIRST_WORKER_RUN), first.stream)
    expect(first.calls[0]?.map((call) => call.name)).toEqual(['hive'])
    const other = recorder()
    await hive.respond(request(identity.replace('worker-1', 'worker-2'), OTHER_WORKER_RUN), other.stream)
    expect(other.calls[0]?.map((call) => call.name)).toEqual(['bash'])
    expect([...hive.sleeping]).toEqual(['worker-2'])
  })
})
