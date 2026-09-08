import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ExplicitWaggleOperationJournal } from '../../ports/explicit-waggle-operation-journal'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-waggle-journal-'))
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

function request(text = 'Run Waggle') {
  return {
    contractVersion: 1 as const,
    requestId: `request-${text}`,
    idempotencyKey: 'waggle-once',
    sessionId: 'session-target',
    payload: { text, thinkingLevel: 'medium' as const, attachments: [] },
    model: SupportedModelId('openai/gpt-5.4'),
    config: {
      mode: 'sequential' as const,
      agents: [
        {
          label: 'A',
          model: 'openai/gpt-5.4',
          roleDescription: 'A',
          color: 'blue' as const,
        },
        {
          label: 'B',
          model: 'openai/gpt-5.4',
          roleDescription: 'B',
          color: 'amber' as const,
        },
      ] as const,
      stop: { primary: 'consensus' as const, maxTurnsSafety: 4 },
    },
  }
}

it('claims, blocks concurrent retries, and durably replays an explicit Waggle report', async () => {
  const input = { callerId: 'gui:local-user', request: request() }
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const journal = yield* ExplicitWaggleOperationJournal
      const claimed = yield* journal.claim(input)
      const pending = yield* journal.claim({
        ...input,
        request: { ...input.request, requestId: 'retry-while-pending' },
      })
      yield* journal.complete({ ...input, report: { outcome: 'delivered' } })
      const replayed = yield* journal.claim({
        ...input,
        request: { ...input.request, requestId: 'retry-after-completion' },
      })
      const conflict = yield* Effect.either(
        journal.claim({ ...input, request: request('Different command') }),
      )
      return { claimed, pending, replayed, conflict }
    }).pipe(
      Effect.provide(makeSessionControlTestLayer(path.join(temporaryRoot, 'session-host.sqlite'))),
    ),
  )

  expect(result.claimed).toEqual({ status: 'claimed' })
  expect(result.pending).toEqual({ status: 'pending', replayed: true })
  expect(result.replayed).toEqual({
    status: 'completed',
    replayed: true,
    report: { outcome: 'delivered' },
  })
  expect(result.conflict._tag).toBe('Left')
})
