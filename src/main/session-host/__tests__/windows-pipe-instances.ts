import { currentUser, READ_CONTROL, windowsSecurityKernel } from '../windows-user-only-security'
import { sidString, verifyUserOnlyDescriptor } from '../windows-security-descriptor'
import { setTimeout as delay } from 'node:timers/promises'
import { windowsProcessKernel } from '../../windows-headless-process'

const INSTANCE_WAIT_MS = 2_000
const INSTANCE_POLL_MS = 10

/**
 * Waits for a free instance of the pipe without blocking this thread: the server that owns it
 * runs here, and replenishes its instances only when its event loop accepts a connection.
 */
async function freeInstance(name: Uint8Array) {
  const deadline = Date.now() + INSTANCE_WAIT_MS
  while (!windowsProcessKernel().waitNamedPipe(name, 1)) {
    if (Date.now() > deadline) return false
    await delay(INSTANCE_POLL_MS)
  }
  return true
}

/**
 * Opens `count` instances of `pipe` at once, each with `READ_CONTROL` only, so it can change
 * nothing, and checks that every one is user-only; returns the user's SID. Windows only.
 */
export async function verifyWindowsPipeInstances(pipe: string, count: number) {
  const kernel = windowsSecurityKernel()
  const user = currentUser(kernel)
  const name = Buffer.from(`${pipe}\0`, 'utf16le')
  const handles: bigint[] = []
  try {
    for (let index = 0; index < count; index += 1) {
      // Lets libuv replenish its pending instances; a failed check is never retried.
      if (!(await freeInstance(name))) {
        throw new Error(`No instance of ${pipe} became available.`)
      }
      const opened = kernel.openPipe(pipe, READ_CONTROL)
      if (opened.handle === null) throw new Error(`Opening ${pipe} failed (${opened.error}).`)
      handles.push(opened.handle)
      const read = kernel.getHandle(opened.handle)
      if (read.error !== 0) throw new Error(`Reading ${pipe}'s security failed (${read.error}).`)
      verifyUserOnlyDescriptor(kernel.takeDescriptor(read.descriptor), user, 'pipe')
    }
  } finally {
    for (const handle of handles) kernel.closeHandle(handle)
  }
  return sidString(user)
}
