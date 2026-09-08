import { constants as osConstants } from 'node:os'
import type * as NodePtyModule from 'node-pty'
import type { IPty } from 'node-pty'

export function createNativeTtyMemberSignal(
  pty: typeof NodePtyModule,
  spawned: IPty,
  ttyIdentity: string,
  spawnProcessIdentity: string,
) {
  const native: unknown = Reflect.get(pty, 'native')
  if (native === null || typeof native !== 'object') return undefined
  const signalByTty: unknown = Reflect.get(native, 'signalByTty')
  const fd: unknown = Reflect.get(spawned, 'fd')
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
