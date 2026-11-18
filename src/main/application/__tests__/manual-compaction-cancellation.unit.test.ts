import { SessionId, SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  cancelAllSessionRuns,
  cancelCompactionSessionRun,
  cancelSessionRuns,
  hasAnyActiveRun,
  listActiveCompactions,
  reserveCompactionSessionWriter,
} from '../active-session-runs'

describe('manual compaction cancellation activity', () => {
  it.each([cancelCompactionSessionRun, cancelSessionRuns, cancelAllSessionRuns])(
    'retains restore metadata until the cancelled writer finishes cleanup with %s',
    (cancel) => {
      const sessionId = SessionId('compaction-cancellation-restore')
      const controller = new AbortController()
      const writer = reserveCompactionSessionWriter(
        sessionId,
        controller,
        SupportedModelId('openai/gpt-5.5'),
      )
      try {
        cancel(sessionId)
        expect(controller.signal.aborted).toBe(true)
        expect(hasAnyActiveRun(sessionId)).toBe(true)
        expect(listActiveCompactions()).toContainEqual(
          expect.objectContaining({ sessionId, activity: 'compaction' }),
        )
      } finally {
        writer.release()
      }
      expect(hasAnyActiveRun(sessionId)).toBe(false)
      expect(listActiveCompactions()).not.toContainEqual(expect.objectContaining({ sessionId }))
    },
  )
})
