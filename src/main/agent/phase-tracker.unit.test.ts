import { ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { StreamChunk } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import {
  getPhaseForConversation,
  resetPhaseForConversation,
  updatePhaseFromOrchestrationEvent,
  updatePhaseFromStreamChunk,
} from './phase-tracker'

const conversationId = ConversationId('conv-1')
const runId = OrchestrationRunId('run-1')

function streamChunk(chunk: StreamChunk, now: number) {
  return updatePhaseFromStreamChunk(conversationId, chunk, now)
}

function orchestrationEvent(
  payload: Omit<OrchestrationEventPayload, 'conversationId' | 'runId' | 'at'> &
    Pick<OrchestrationEventPayload, 'type'>,
  now: number,
) {
  return updatePhaseFromOrchestrationEvent(
    {
      conversationId,
      runId,
      at: new Date(now).toISOString(),
      ...payload,
    },
    now,
  )
}

describe('phase-tracker', () => {
  it('maps single-agent stream to Thinking -> Writing -> null', () => {
    const t0 = 1_000
    expect(
      streamChunk(
        {
          type: 'RUN_STARTED',
          timestamp: t0,
          runId: 'r1',
        },
        t0,
      ),
    ).toMatchObject({ changed: true, phase: { label: 'Thinking', startedAt: t0 } })

    expect(
      streamChunk(
        {
          type: 'TEXT_MESSAGE_CONTENT',
          timestamp: t0 + 10,
          messageId: 'm1',
          delta: 'Hello',
        },
        t0 + 10,
      ),
    ).toMatchObject({ changed: true, phase: { label: 'Writing', startedAt: t0 + 10 } })

    expect(
      streamChunk(
        {
          type: 'RUN_FINISHED',
          timestamp: t0 + 20,
          runId: 'r1',
          finishReason: 'stop',
        },
        t0 + 20,
      ),
    ).toMatchObject({ changed: true, phase: null })
  })

  it('maps orchestration events to Planning/Researching/Reviewing/Writing', () => {
    const t0 = 2_000
    expect(orchestrationEvent({ type: 'run_started' }, t0)).toMatchObject({
      changed: true,
      phase: { label: 'Planning', startedAt: t0 },
    })

    orchestrationEvent(
      { type: 'task_queued', taskId: OrchestrationTaskId('task-1'), taskKind: 'analysis' },
      t0 + 1,
    )
    expect(
      orchestrationEvent(
        { type: 'task_started', taskId: OrchestrationTaskId('task-1'), taskKind: 'analysis' },
        t0 + 2,
      ),
    ).toMatchObject({
      changed: true,
      phase: { label: 'Researching', startedAt: t0 + 2 },
    })

    expect(
      orchestrationEvent({ type: 'task_succeeded', taskId: OrchestrationTaskId('task-1') }, t0 + 3),
    ).toMatchObject({
      changed: true,
      phase: { label: 'Reviewing', startedAt: t0 + 3 },
    })

    expect(orchestrationEvent({ type: 'run_completed' }, t0 + 4)).toMatchObject({
      changed: true,
      phase: { label: 'Writing', startedAt: t0 + 4 },
    })
  })

  it('supports explicit phase reset', () => {
    const t0 = 3_000
    streamChunk(
      {
        type: 'RUN_STARTED',
        timestamp: t0,
        runId: 'r2',
      },
      t0,
    )
    expect(resetPhaseForConversation(conversationId)).toEqual({ changed: true, phase: null })
    expect(resetPhaseForConversation(conversationId)).toEqual({ changed: false, phase: null })
  })

  it('returns current phase snapshot and clears between runs', () => {
    const t0 = 4_000
    streamChunk(
      {
        type: 'RUN_STARTED',
        timestamp: t0,
        runId: 'r3',
      },
      t0,
    )

    expect(getPhaseForConversation(conversationId)).toEqual({
      label: 'Thinking',
      startedAt: t0,
    })

    resetPhaseForConversation(conversationId)

    const t1 = 5_000
    streamChunk(
      {
        type: 'RUN_STARTED',
        timestamp: t1,
        runId: 'r4',
      },
      t1,
    )

    expect(getPhaseForConversation(conversationId)).toEqual({
      label: 'Thinking',
      startedAt: t1,
    })
  })
})
