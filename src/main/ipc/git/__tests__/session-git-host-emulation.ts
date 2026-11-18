/*
 * The window asks the Session Host to verify a Session's working path and record its Git Outputs
 * (A-F5). The Host runs these same operations against its store; here they run against a test's
 * layer.
 */

import { SessionId } from '@shared/types/brand'
import type { SessionGitOutputsPayload } from '@shared/types/git'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import { vi } from 'vitest'
import type {
  recordSessionGitOutputsOperation,
  verifySessionGitWorkingPath,
} from '../../../application/session-git-outputs'

type SessionGitHostServices =
  | Effect.Effect.Context<ReturnType<typeof recordSessionGitOutputsOperation>>
  | Effect.Effect.Context<ReturnType<typeof verifySessionGitWorkingPath>>

const host = vi.hoisted(() => {
  const state: { run: (channel: string, args: readonly unknown[]) => Promise<unknown> } = {
    run: async () => ({ handled: false }),
  }
  return state
})

vi.mock('../../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: (channel: string, args: readonly unknown[]) => host.run(channel, args),
}))

export function emulateSessionGitHost(layer: Layer.Layer<SessionGitHostServices>) {
  host.run = async (channel, args) => {
    // Loaded here, after the Git harness mocked child_process for the modules it reaches.
    const operations = await import('../../../application/session-git-outputs')
    const sessionId = SessionId(String(args[0]))
    if (channel === 'git:session:verify-working-path') {
      const verification = operations.verifySessionGitWorkingPath(sessionId, String(args[1]))
      return { handled: true, result: await Effect.runPromise(Effect.provide(verification, layer)) }
    }
    if (channel !== 'git:session:record-outputs') return { handled: false }
    const payload = fromAny<SessionGitOutputsPayload, unknown>(args[1])
    const recording = operations.recordSessionGitOutputsOperation(sessionId, payload)
    return { handled: true, result: await Effect.runPromise(Effect.provide(recording, layer)) }
  }
}
