/**
 * Starts an OpenWaggle-owned process that outlives this one, with no inherited descriptors. Free
 * of OpenWaggle runtime imports: the boot shim launches the GUI's Session Host through it before
 * the main bundle loads (src/main/boot/session-host-prelaunch.ts). Callers that may create native
 * UI go through `desktop-ui.ts`, which keeps automation's fail-closed boundary.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, openSync, readdirSync } from 'node:fs'
import { devNull } from 'node:os'

export interface DetachedProcessLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: Readonly<Record<string, string | undefined>>
}

const MAX_DETACHED_DESCRIPTOR = 65_535
const LAST_CONTROL_DESCRIPTOR = 4
const STANDARD_IO_DESCRIPTOR_COUNT = 3

function isolatedLinuxStdio(ownedDescriptors: Set<number>): Array<'ignore' | number> {
  let nullDescriptor = openSync(devNull, 'r+')
  ownedDescriptors.add(nullDescriptor)
  let lastDescriptor = LAST_CONTROL_DESCRIPTOR
  for (const entry of [...readdirSync('/proc/self/fd'), String(nullDescriptor)]) {
    const descriptor = Number(entry)
    if (
      !/^\d+$/u.test(entry) ||
      !Number.isSafeInteger(descriptor) ||
      descriptor > MAX_DETACHED_DESCRIPTOR
    ) {
      throw new Error(
        'Cannot isolate detached process descriptors: invalid or excessive descriptor.',
      )
    }
    lastDescriptor = Math.max(lastDescriptor, descriptor)
  }
  // libuv duplicates low source FDs above stdio_count for every higher destination.
  // Reserve a high source through the holes instead, avoiding transient EMFILE even
  // when the existing snapshot is sparse and close to the process descriptor limit.
  while (nullDescriptor < lastDescriptor) {
    nullDescriptor = openSync(devNull, 'r+')
    ownedDescriptors.add(nullDescriptor)
  }
  // Only the high source must survive until spawn. Free the reserved holes first so
  // libuv can allocate its own launch pipe even near the process descriptor limit.
  for (const descriptor of ownedDescriptors) {
    if (descriptor === nullDescriptor) continue
    closeSync(descriptor)
    ownedDescriptors.delete(descriptor)
  }
  // Cover holes too: another native thread can reuse one before spawn. A descriptor
  // opened above this synchronous snapshot remains a Node spawn API limitation.
  return Array.from({ length: lastDescriptor + 1 }, (_, index) =>
    index < STANDARD_IO_DESCRIPTOR_COUNT ? 'ignore' : nullDescriptor,
  )
}

/**
 * Spawns the detached process and returns it at once; it is not yet known to have started. The
 * caller unreferences it once it has, so this process can exit before it.
 */
export function spawnDetachedProcess(input: DetachedProcessLaunch): ChildProcess {
  // Linux Electron can retain client pipes and Chromium sockets even with UV_IGNORE.
  // Replace the parent snapshot before exec; never close the new Host's own handles.
  const ownedDescriptors = new Set<number>()
  try {
    return spawn(input.command, [...input.args], {
      detached: true,
      stdio: process.platform === 'linux' ? isolatedLinuxStdio(ownedDescriptors) : 'ignore',
      windowsHide: true,
      env: { ...input.environment },
    })
  } finally {
    for (const descriptor of ownedDescriptors) closeSync(descriptor)
  }
}

/** Starts the detached process and resolves once it has started, or rejects if it could not. */
export function launchDetachedProcess(input: DetachedProcessLaunch) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnDetachedProcess(input)
    const handleError = (error: Error) => {
      child.removeListener('spawn', handleSpawn)
      reject(error)
    }
    const handleSpawn = () => {
      child.removeListener('error', handleError)
      child.unref()
      resolve()
    }
    child.once('error', handleError)
    child.once('spawn', handleSpawn)
  })
}
