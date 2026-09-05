import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SESSION_LINK_CAPTURE_LIMIT } from './session-resource-capture'
import { captureLink, linkOccurrenceId } from './session-resource-capture-link'
import type { CapturedLink } from './session-resource-extraction'

export interface BackfillLinkState {
  count: number
  readonly capturedOccurrences: Set<string>
  projectionBlocked: boolean
  progressed: boolean
}

export function captureBackfilledLinks(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly links: readonly CapturedLink[]
  readonly nodeId: string
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly createdAt: number
  readonly branchId: string | null
  readonly state: BackfillLinkState
}) {
  return Effect.gen(function* () {
    for (const [index, link] of input.links.entries()) {
      const captureInput = {
        sessionId: input.sessionId,
        runId: input.runId,
        link,
        index,
        nodeId: input.nodeId,
        actor: input.actor,
        activity: input.activity,
        createdAt: input.createdAt,
        branchId: input.branchId,
      }
      const id = linkOccurrenceId(captureInput)
      if (input.state.capturedOccurrences.has(id)) continue
      if (input.state.count >= SESSION_LINK_CAPTURE_LIMIT) {
        input.state.projectionBlocked = true
        break
      }
      input.state.count += 1
      yield* captureLink(captureInput)
      input.state.capturedOccurrences.add(id)
      input.state.progressed = true
    }
  })
}
