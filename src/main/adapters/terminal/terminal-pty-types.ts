import type * as NodePtyModule from 'node-pty'
import type { IPty } from 'node-pty'
import type { PreparedEnvironment } from '../../domain/prepared-environment'
import type { observeTerminalProcessLifecycle } from './terminal-process-exit-observation'
import type { TerminalProcessMetadata } from './terminal-process-identity'

export interface PtySpawnRequest {
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly env: PreparedEnvironment
  /** Generation-scoped token required by the shell prompt-readiness marker. */
  readonly readinessNonce: string
  /** An owned finite command. It bypasses interactive prompt integration and exits with the task. */
  readonly execution?: { readonly command: string; readonly args: readonly string[] }
}

export type PtySpawnOutcome =
  | {
      readonly ok: true
      readonly pty: IPty
      readonly pid: number
      readonly shell: string
      readonly tty: string | null
      /** Root identity captured synchronously by native code before its waiter can reap. */
      readonly processIdentity: { readonly pid: number; readonly startedAt: string } | null
      /** Exact slave device derived from the PTY master, independent of path text. */
      readonly ttyIdentity: string | null
      /** Already-running targeted spawn probe; bounded to 25 ms. */
      readonly processMetadata: Promise<TerminalProcessMetadata | null>
      /** Installed synchronously after spawn and shared by every cleanup path. */
      readonly exit: ReturnType<typeof observeTerminalProcessLifecycle>['exit']
      readonly processTreeExit: ReturnType<
        typeof observeTerminalProcessLifecycle
      >['processTreeExit']
      readonly resourceDrain: ReturnType<typeof observeTerminalProcessLifecycle>['resourceDrain']
      readonly pauseOutput: () => void
      readonly resumeOutput: () => void
      /** Descriptor-bound native PTY membership signal on supported POSIX hosts. */
      readonly signalTtyMembers?: (force: boolean) => number | null
    }
  | { readonly ok: false; readonly error: Error }

export interface PtyRunner {
  /** Spawn a shell in cwd, retrying down the shell fallback chain (ADR 0030). */
  readonly spawn: (request: PtySpawnRequest) => Promise<PtySpawnOutcome>
  /** Resolve the node-pty module lazily (native module, loaded on first use). */
  readonly load: () => Promise<typeof NodePtyModule>
}

export interface PtyRunnerOptions {
  readonly appVersion: string
  readonly loadPty?: () => Promise<typeof NodePtyModule>
}
