import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { TerminalService } from '../../ports/terminal-service'

/** Minimal no-op TerminalService for handler tests that never drive terminals. */
export const NoopTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    open: () => Effect.succeed({ history: '', outputBytes: 0, running: false }),
    write: () => Effect.void,
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () => Effect.succeed({ history: '', outputBytes: 0, running: false }),
    close: () => Effect.void,
    closeAllForOwner: () => Effect.void,
    closeAllUnderPath: () => Effect.void,
    attachSurface: () => Effect.void,
    detachTerminal: () => Effect.void,
    detachSurface: () => Effect.void,
    closeAll: () => Effect.void,
  }),
)
