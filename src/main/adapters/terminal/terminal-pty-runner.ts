import os from 'node:os'
import { TERMINAL } from '@shared/constants/resource-limits'
import type * as NodePtyModule from 'node-pty'
import type { IPty } from 'node-pty'
import { getSafeChildEnv } from '../../env'
import { createLogger } from '../../logger'
import { existingShells } from './terminal-shell'

const logger = createLogger('terminal-pty-runner')

const MIN_SPAWN_COLS = TERMINAL.MIN_COLS
const MIN_SPAWN_ROWS = TERMINAL.MIN_ROWS
export const SPAWN_FAILURE_EXIT_CODE = -1

export interface PtySpawnRequest {
  readonly cwd: string
  readonly cols: number
  readonly rows: number
}

export type PtySpawnOutcome =
  | { readonly ok: true; readonly pty: IPty; readonly pid: number; readonly shell: string }
  | { readonly ok: false; readonly error: Error }

export interface PtyRunner {
  /** Spawn a shell in cwd, retrying down the shell fallback chain (ADR 0030). */
  readonly spawn: (request: PtySpawnRequest) => Promise<PtySpawnOutcome>
  /** Resolve the node-pty module lazily (native module, loaded on first use). */
  readonly load: () => Promise<typeof NodePtyModule>
}

/**
 * node-pty 1.1.0 creates the master-side tty.ReadStream without resuming it.
 * Whether a paused fd-backed stream starts flowing is a runtime detail: plain
 * Node starts it, Electron's build does not, so the shell's first output (the
 * prompt) sits in the kernel buffer until some later write kicks the stream —
 * rendered as a dead, empty terminal. Resuming here is a no-op on runtimes
 * that already started the stream.
 */
function resumeMasterStream(spawned: IPty) {
  const socket: unknown = Reflect.get(spawned, '_socket')
  if (socket === null || typeof socket !== 'object') return
  const resume: unknown = Reflect.get(socket, 'resume')
  if (typeof resume === 'function') {
    Reflect.apply(resume, socket, [])
  }
}

export function makePtyRunner(loadPty?: () => Promise<typeof NodePtyModule>): PtyRunner {
  let ptyModule: typeof NodePtyModule | null = null

  const loadPtyModule = async () => {
    if (ptyModule === null) {
      ptyModule = loadPty ? await loadPty() : await import('node-pty')
    }
    return ptyModule
  }

  const childEnv = () => {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(getSafeChildEnv())) {
      if (value !== undefined) env[key] = value
    }
    // Windows ConPTY ignores node-pty's `name`, so TERM must be forced (t3code fix).
    env.TERM = 'xterm-256color'
    return env
  }

  const spawn = async (request: PtySpawnRequest) => {
    const pty = await loadPtyModule()
    // Login shell on macOS (like Terminal.app and VSCode) so the user's full
    // profile (~/.zprofile etc.) is sourced and their environment is inferred.
    const spawnArgs = os.platform() === 'darwin' ? ['-l'] : []
    for (const shell of existingShells()) {
      try {
        const spawned = pty.spawn(shell, spawnArgs, {
          name: 'xterm-256color',
          cols: Math.max(MIN_SPAWN_COLS, Math.min(TERMINAL.MAX_COLS, request.cols)),
          rows: Math.max(MIN_SPAWN_ROWS, Math.min(TERMINAL.MAX_ROWS, request.rows)),
          cwd: request.cwd,
          env: childEnv(),
        })
        resumeMasterStream(spawned)
        return {
          ok: true,
          pty: spawned,
          pid: spawned.pid,
          shell: basename(shell),
        } satisfies PtySpawnOutcome
      } catch (error) {
        logger.warn('Terminal shell spawn failed, trying fallback', {
          shell,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return {
      ok: false,
      error: new Error('No terminal shell could be spawned.'),
    } satisfies PtySpawnOutcome
  }

  return { spawn, load: loadPtyModule }
}

function basename(shellPath: string) {
  const normalized = shellPath.replaceAll('\\', '/')
  return normalized.split('/').pop() ?? shellPath
}
