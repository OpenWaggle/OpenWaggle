import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { TerminalService } from '../../ports/terminal-service'

/** Minimal no-op TerminalService for handler tests that never drive terminals. */
export const NoopTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    getActivitySnapshot: () => Effect.succeed({ revision: 0, summaries: [], truncated: false }),
    open: () =>
      Effect.succeed({
        history: '',
        outputBytes: 0,
        outputGeneration: 0,
        readiness: null,
        running: false,
        processName: null,
        ports: [],
        projectActionPending: false,
      }),
    write: () => Effect.succeed({ status: 'written', acceptedBytes: 0 }),
    sendInputNow: () => Effect.succeed({ status: 'already-ready', releasedBytes: 0 }),
    acknowledgeOutput: () => Effect.void,
    migrateOwner: () => Effect.succeed({ terminalIds: [] }),
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () =>
      Effect.succeed({
        history: '',
        outputBytes: 0,
        outputGeneration: 0,
        readiness: null,
        running: false,
        processName: null,
        ports: [],
        projectActionPending: false,
      }),
    assessClose: () => Effect.succeed({ disposition: 'safe', reason: 'dead' }),
    close: () => Effect.void,
    closeAllForOwner: () => Effect.void,
    closeAllUnderPath: () => Effect.void,
    runWithMutationFence: (_scope, operation) => operation,
    attachSurface: () => Effect.void,
    detachTerminal: () => Effect.void,
    detachSurface: () => Effect.void,
    closeAll: () => Effect.void,
  }),
)
