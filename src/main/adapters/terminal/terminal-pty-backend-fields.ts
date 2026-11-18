import type * as NodePtyModule from 'node-pty'
import type { IPty } from 'node-pty'
import type { UncheckedFields } from '@shared/types/unchecked-fields'

type BackendMethod = (...args: never[]) => unknown

/**
 * What OpenWaggle's terminal backend adds to a spawned node-pty process beyond the published
 * types. An older or foreign build may lack any of it, so each member is checked before use.
 */
interface TerminalBackendProcess {
  readonly pid: IPty['pid']
  readonly spawnProcessIdentity: string
  readonly ttyIdentity: string
  readonly fd: number
  readonly closeDescriptor: BackendMethod
  readonly waitForResourceDrain: BackendMethod
  readonly onProcessTreeExit: BackendMethod
  /** node-pty's private socket and controlling TTY path on POSIX. */
  readonly _socket: object
  readonly _pty: string
}

/** What the terminal backend module adds to node-pty's published exports. */
interface TerminalBackendModule {
  readonly spawn: typeof NodePtyModule.spawn
  readonly processTable: BackendMethod
  readonly listeningPorts: BackendMethod
  readonly native: object
}

/** The native binding behind the terminal backend module on POSIX. */
export interface TerminalBackendNative {
  readonly processInfos: BackendMethod
  readonly signalProcess: BackendMethod
  readonly signalByTty: BackendMethod
}

/** A spawned process's backend members, each unchecked. */
export function terminalBackendProcess(spawned: IPty) {
  const fields: UncheckedFields<TerminalBackendProcess> = spawned
  return fields
}

/** The backend module's added exports, each unchecked. */
export function terminalBackendModule(pty: typeof NodePtyModule) {
  const fields: UncheckedFields<TerminalBackendModule> = pty
  return fields
}
