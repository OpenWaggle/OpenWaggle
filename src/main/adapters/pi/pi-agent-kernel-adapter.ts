import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import {
  type AgentKernelRunInput,
  AgentKernelService,
  type AgentKernelSessionInput,
  type AgentKernelWaggleRunInput,
  type CompactAgentKernelSessionInput,
  type ForkAgentKernelSessionInput,
  type NavigateAgentKernelSessionInput,
} from '../../ports/agent-kernel-service'
import { runPiSession } from './agent-kernel/classic-run'
import {
  compactPiSession,
  forkPiSession,
  getPiContextUsage,
  getPiSessionSnapshot,
  navigatePiSessionTree,
} from './agent-kernel/session-operations'
import { createPiSession } from './agent-kernel/session-runtime'

export { createSessionListener } from './agent-kernel/session-listener'

import { runPiWaggle } from './agent-kernel/waggle-run'

function toAgentKernelError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

export const PiAgentKernelLive = Layer.succeed(
  AgentKernelService,
  AgentKernelService.of({
    createSession: (input) =>
      Effect.tryPromise({
        try: () => createPiSession(input.projectPath),
        catch: toAgentKernelError,
      }),

    run: (input: AgentKernelRunInput) =>
      Effect.tryPromise({
        try: () => runPiSession(input),
        catch: toAgentKernelError,
      }),

    runWaggle: (input: AgentKernelWaggleRunInput) =>
      Effect.tryPromise({
        try: () => runPiWaggle(input),
        catch: toAgentKernelError,
      }),

    getContextUsage: (input: AgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => getPiContextUsage(input),
        catch: toAgentKernelError,
      }),

    getSessionSnapshot: (input: AgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => getPiSessionSnapshot(input),
        catch: toAgentKernelError,
      }),

    compact: (input: CompactAgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => compactPiSession(input),
        catch: toAgentKernelError,
      }),

    navigateTree: (input: NavigateAgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => navigatePiSessionTree(input),
        catch: toAgentKernelError,
      }),

    forkSession: (input: ForkAgentKernelSessionInput) =>
      Effect.tryPromise({
        try: () => forkPiSession(input),
        catch: toAgentKernelError,
      }),
  }),
)
