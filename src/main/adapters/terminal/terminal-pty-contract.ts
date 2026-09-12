import type * as NodePtyModule from 'node-pty'
import type { IPty } from 'node-pty'

function spawnProcessIdentity(spawned: IPty, pid: number) {
  const value: unknown = Reflect.get(spawned, 'spawnProcessIdentity')
  return typeof value === 'string' && value.length > 0 ? { pid, startedAt: value } : null
}

function controllingTtyIdentity(spawned: IPty) {
  const value: unknown = Reflect.get(spawned, 'ttyIdentity')
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function assertTerminalModuleContract(pty: typeof NodePtyModule) {
  if (process.platform === 'win32') {
    if (
      typeof Reflect.get(pty, 'processTable') !== 'function' ||
      typeof Reflect.get(pty, 'listeningPorts') !== 'function'
    ) {
      throw new Error(
        'The installed Windows terminal backend cannot query native process and listener metadata.',
      )
    }
    return
  }
  const native: unknown = Reflect.get(pty, 'native')
  if (
    native !== null &&
    typeof native === 'object' &&
    typeof Reflect.get(native, 'processInfos') === 'function' &&
    typeof Reflect.get(native, 'signalProcess') === 'function' &&
    typeof Reflect.get(native, 'signalByTty') === 'function'
  ) {
    return
  }
  throw new Error(
    'The installed POSIX terminal backend cannot verify process identity and descriptor-bound PTY membership.',
  )
}

export function captureDescriptorClose(spawned: IPty) {
  try {
    const closeDescriptor: unknown = Reflect.get(spawned, 'closeDescriptor')
    return typeof closeDescriptor === 'function'
      ? () => {
          Reflect.apply(closeDescriptor, spawned, [])
        }
      : null
  } catch {
    return null
  }
}

export function closeRejectedSpawn(spawned: IPty, closeDescriptor: (() => void) | null) {
  try {
    if (closeDescriptor !== null) {
      closeDescriptor()
      return
    }
    // A stale Windows backend still owns a stable native process handle. POSIX
    // never falls back to a stored numeric PID across a possible reuse race.
    if (process.platform === 'win32') spawned.kill()
  } catch {
    // Preserve the original contract failure. Install/package probes make this
    // branch unreachable for a supported native artifact.
  }
}

export function assertSpawnLifecycleContract(spawned: IPty, closeDescriptor: (() => void) | null) {
  const pid: unknown = Reflect.get(spawned, 'pid')
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) {
    throw new Error('Terminal backend returned an invalid root process id.')
  }
  if (
    closeDescriptor === null ||
    typeof Reflect.get(spawned, 'waitForResourceDrain') !== 'function'
  ) {
    throw new Error('The installed terminal backend cannot close and drain PTY resources safely.')
  }

  if (process.platform === 'win32') {
    if (typeof Reflect.get(spawned, 'onProcessTreeExit') !== 'function') {
      throw new Error(
        'The installed Windows terminal backend cannot prove process-tree exit and resource drain.',
      )
    }
    return {
      pid: Number(pid),
      processIdentity: null,
      ttyIdentity: null,
      fd: null,
    }
  }

  const processIdentity = spawnProcessIdentity(spawned, Number(pid))
  const ttyIdentity = controllingTtyIdentity(spawned)
  const fd: unknown = Reflect.get(spawned, 'fd')
  if (
    processIdentity === null ||
    ttyIdentity === null ||
    !Number.isSafeInteger(fd) ||
    Number(fd) < 0
  ) {
    throw new Error(
      'The installed POSIX terminal backend cannot prove the spawned process and PTY identities.',
    )
  }
  return { pid: Number(pid), processIdentity, ttyIdentity, fd: Number(fd) }
}
