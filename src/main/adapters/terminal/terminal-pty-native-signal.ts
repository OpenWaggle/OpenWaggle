import type { Pty, PtyModule } from './terminal-pty-backend'
import { constants as osConstants } from 'node:os'
import {
  terminalBackendModule,
  type TerminalBackendNative,
  terminalBackendProcess,
} from './terminal-pty-backend-fields'
import { uncheckedFields } from '@shared/utils/object-shape'

export function createNativeTtyMemberSignal(
  pty: PtyModule,
  spawned: Pty,
  ttyIdentity: string,
  spawnProcessIdentity: string,
) {
  const native: unknown = terminalBackendModule(pty).native
  const nativeFields = uncheckedFields<TerminalBackendNative>(native)
  if (native === null || typeof native !== 'object') return undefined
  const signalByTty: unknown = nativeFields.signalByTty
  const fd: unknown = terminalBackendProcess(spawned).fd
  if (typeof signalByTty !== 'function' || !Number.isInteger(fd) || Number(fd) < 0) {
    return undefined
  }
  const masterFd = Number(fd)
  const rootPid = spawned.pid
  return (force: boolean) => {
    try {
      const signal = force ? osConstants.signals.SIGKILL : osConstants.signals.SIGHUP
      const result: unknown = Reflect.apply(signalByTty, native, [
        masterFd,
        ttyIdentity,
        rootPid,
        spawnProcessIdentity,
        signal,
      ])
      return typeof result === 'number' && Number.isInteger(result) ? result : null
    } catch {
      return null
    }
  }
}
