import { TERMINAL } from '@shared/constants/resource-limits'
import type * as NodePtyModule from 'node-pty'
import type { IPty } from 'node-pty'
import { assertDesktopNativeAdmission } from '../../desktop-native-admission'
import { getInteractiveTerminalEnv } from '../../env'
import { createLogger } from '../../logger'
import { observeTerminalProcessLifecycle } from './terminal-process-exit-observation'
import type { TerminalProcessMetadata } from './terminal-process-identity'
import { installTerminalProcessKernelApi } from './terminal-process-kernel-api'
import { readProcessMetadata } from './terminal-process-probes'
import {
  assertSpawnLifecycleContract,
  assertTerminalModuleContract,
  captureDescriptorClose,
  closeRejectedSpawn,
} from './terminal-pty-contract'
import { createNativeTtyMemberSignal } from './terminal-pty-native-signal'
import { existingShells, type TerminalShellCandidate } from './terminal-shell'
import { prepareTerminalShellLaunch } from './terminal-shell-integration'

const logger = createLogger('terminal-pty-runner')

const MIN_SPAWN_COLS = TERMINAL.MIN_COLS
const MIN_SPAWN_ROWS = TERMINAL.MIN_ROWS
export const SPAWN_FAILURE_EXIT_CODE = -1

export interface PtySpawnRequest {
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly env: Readonly<Record<string, string>>
  /** Generation-scoped token required by the shell prompt-readiness marker. */
  readonly readinessNonce: string
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

/**
 * node-pty 1.1.0 creates the master-side tty.ReadStream without resuming it.
 * Whether a paused fd-backed stream starts flowing is a runtime detail: plain
 * Node starts it, Electron's build does not, so the shell's first output (the
 * prompt) sits in the kernel buffer until some later write kicks the stream —
 * rendered as a dead, empty terminal. Resuming here is a no-op on runtimes
 * that already started the stream.
 */
function createOutputFlowControl(spawned: IPty) {
  const socket: unknown = Reflect.get(spawned, '_socket')
  let state: 'paused' | 'resumed' | 'unknown' = 'unknown'

  const invoke = (method: 'pause' | 'resume') => {
    if (socket === null || typeof socket !== 'object') return
    const callback: unknown = Reflect.get(socket, method)
    if (typeof callback !== 'function') return
    try {
      Reflect.apply(callback, socket, [])
    } catch (error) {
      logger.warn('Terminal output flow control unavailable', {
        method,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    pauseOutput: () => {
      if (state === 'paused') return
      state = 'paused'
      invoke('pause')
    },
    resumeOutput: () => {
      if (state === 'resumed') return
      state = 'resumed'
      invoke('resume')
    },
  }
}

function controllingTtyName(spawned: IPty) {
  const value: unknown = Reflect.get(spawned, '_pty')
  if (typeof value !== 'string' || !value.startsWith('/dev/')) return null
  const tty = value.slice('/dev/'.length)
  const segments = tty.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return null
  }
  return tty
}

function cleanLaunchWhenDrained(
  lifecycle: ReturnType<typeof observeTerminalProcessLifecycle>,
  cleanup: () => Promise<void>,
  shell: string,
) {
  void Promise.race([lifecycle.exit.whenExited, lifecycle.resourceDrain.whenDrained]).then(() => {
    void cleanup().catch((error: unknown) => {
      logger.warn('Terminal shell prompt integration cleanup failed', {
        shell,
        error: toError(error).message,
      })
    })
  })
}

function makeLaunchCleanup(launch: Awaited<ReturnType<typeof prepareTerminalShellLaunch>>) {
  let cleanupPromise: Promise<void> | null = null
  return () => {
    cleanupPromise ??= launch.cleanup()
    return cleanupPromise
  }
}

function makePtyModuleLoader(options: PtyRunnerOptions) {
  let ptyModule: typeof NodePtyModule | null = null
  return async () => {
    if (ptyModule === null) {
      const loaded = options.loadPty ? await options.loadPty() : await import('node-pty')
      assertTerminalModuleContract(loaded)
      installTerminalProcessKernelApi(loaded)
      ptyModule = loaded
    }
    return ptyModule
  }
}

export function makePtyRunner(options: PtyRunnerOptions): PtyRunner {
  const loadPtyModule = makePtyModuleLoader(options)
  const spawn = async (request: PtySpawnRequest) => {
    let pty: typeof NodePtyModule
    try {
      pty = await loadPtyModule()
    } catch (error) {
      return { ok: false, error: toError(error) } satisfies PtySpawnOutcome
    }
    const environment = getInteractiveTerminalEnv(options.appVersion, request.env)
    let candidates: readonly TerminalShellCandidate[]
    try {
      candidates = existingShells({ environment })
    } catch (error) {
      return { ok: false, error: toError(error) } satisfies PtySpawnOutcome
    }

    let lastMissingShellError: Error | undefined
    for (const candidate of candidates) {
      let launch: Awaited<ReturnType<typeof prepareTerminalShellLaunch>>
      try {
        launch = await prepareTerminalShellLaunch(candidate, environment, request.readinessNonce)
      } catch (error) {
        const integrationError = toError(error)
        logger.error('Terminal shell prompt integration failed', {
          shell: candidate.command,
          error: integrationError.message,
        })
        return { ok: false, error: integrationError } satisfies PtySpawnOutcome
      }

      const cleanupLaunch = makeLaunchCleanup(launch)
      let spawned: IPty | null = null
      let closeDescriptor: (() => void) | null = null
      try {
        assertDesktopNativeAdmission()
        spawned = pty.spawn(candidate.command, [...launch.args], {
          name: 'xterm-256color',
          cols: Math.max(MIN_SPAWN_COLS, Math.min(TERMINAL.MAX_COLS, request.cols)),
          rows: Math.max(MIN_SPAWN_ROWS, Math.min(TERMINAL.MAX_ROWS, request.rows)),
          cwd: request.cwd,
          env: launch.environment,
        })
        closeDescriptor = captureDescriptorClose(spawned)
        const { pid, processIdentity, ttyIdentity, fd } = assertSpawnLifecycleContract(
          spawned,
          closeDescriptor,
        )
        const lifecycle = observeTerminalProcessLifecycle(spawned, {
          requireProcessTreeExit: process.platform === 'win32',
          requireResourceDrain: true,
        })
        const { exit } = lifecycle
        const tty = controllingTtyName(spawned)
        const processMetadata = (
          processIdentity === null || ttyIdentity === null
            ? Promise.resolve(null)
            : readProcessMetadata(pid, undefined, processIdentity.startedAt, ttyIdentity)
        ).then(
          (metadata) => (exit.exitCode === null ? metadata : null),
          () => null,
        )
        cleanLaunchWhenDrained(lifecycle, cleanupLaunch, candidate.command)
        const outputFlow = createOutputFlowControl(spawned)
        const signalTtyMembers =
          fd === null || ttyIdentity === null || processIdentity === null
            ? undefined
            : createNativeTtyMemberSignal(pty, spawned, ttyIdentity, processIdentity.startedAt)
        // Hold the fd-backed stream until the generation-aware data listener
        // is attached. The kernel PTY buffer preserves even an immediate
        // prompt; attachLiveShell resumes it in the same task turn.
        outputFlow.pauseOutput()
        return {
          ok: true,
          pty: spawned,
          pid,
          shell: candidate.label,
          tty,
          processIdentity,
          ttyIdentity,
          processMetadata,
          ...lifecycle,
          ...outputFlow,
          ...(signalTtyMembers === undefined ? {} : { signalTtyMembers }),
        } satisfies PtySpawnOutcome
      } catch (error) {
        if (spawned !== null) closeRejectedSpawn(spawned, closeDescriptor)
        await cleanupLaunch().catch((cleanupError: unknown) => {
          logger.warn('Terminal shell prompt integration cleanup failed', {
            shell: candidate.command,
            error: toError(cleanupError).message,
          })
        })
        const spawnError = toError(error)
        if (!isMissingShellError(error)) {
          logger.error('Terminal shell spawn failed', {
            shell: candidate.command,
            error: spawnError.message,
          })
          return { ok: false, error: spawnError } satisfies PtySpawnOutcome
        }
        lastMissingShellError = spawnError
        logger.warn('Terminal shell spawn failed, trying fallback', {
          shell: candidate.command,
          error: spawnError.message,
        })
      }
    }
    return {
      ok: false,
      error: new Error('No terminal shell could be spawned.', {
        cause: lastMissingShellError,
      }),
    } satisfies PtySpawnOutcome
  }

  return { spawn, load: loadPtyModule }
}

function isMissingShellError(error: unknown) {
  if (error !== null && typeof error === 'object') {
    const code: unknown = Reflect.get(error, 'code')
    if (code === 'ENOENT') return true
  }
  if (!(error instanceof Error)) return false
  return error.message.includes('ENOENT') || error.message.startsWith('File not found:')
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
