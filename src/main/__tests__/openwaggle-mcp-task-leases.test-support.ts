import { Effect } from 'effect'
import type { OpenWaggleServerTaskManager } from '../openwaggle-mcp-task-manager'
import { OpenWaggleMcpTaskStore } from '../openwaggle-mcp-task-store'

const POLL_DEADLINE_MS = 2_000
const POLL_INTERVAL_MS = 10

export async function waitForTaskStatus(
  manager: OpenWaggleServerTaskManager,
  taskId: string,
  status: string,
) {
  const deadline = Date.now() + POLL_DEADLINE_MS
  while (Date.now() < deadline) {
    const task = await Effect.runPromise(manager.get(taskId))
    if (task.status === status) return task
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Task ${taskId} did not reach ${status}.`)
}

/**
 * Wait until the owner's heartbeat has *observably* renewed the lease past `minimumExpiresAt`.
 *
 * The lease tests drive expiry with a virtual clock but the heartbeat runs on real time, so
 * asserting "a heartbeat fired" via a fixed sleep is a race: on a contended runner the
 * interval can miss the window, the original expiry stands, and recovery then correctly
 * interrupts the task. That made `renews a live owner lease` fail intermittently in CI while
 * passing locally. Polling the persisted lease makes the precondition observed instead of
 * assumed, so the test asserts the behaviour it means to assert regardless of scheduling.
 */
export async function waitForLeaseRenewedBeyond(
  taskStorePath: string,
  taskId: string,
  minimumExpiresAt: number,
) {
  const store = new OpenWaggleMcpTaskStore(taskStorePath)
  const deadline = Date.now() + POLL_DEADLINE_MS
  while (Date.now() < deadline) {
    const tasks = await store.readTasks()
    const record = tasks.find((candidate) => candidate.id === taskId)
    // `lease` is optional *and* nullable: an unleased task may omit it or store null.
    const expiresAt = record?.lease?.expiresAt
    if (expiresAt !== undefined && expiresAt > minimumExpiresAt) return
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(
    `Lease for task ${taskId} was not renewed beyond ${String(minimumExpiresAt)} by the heartbeat.`,
  )
}
