import { createServer } from 'node:net'
import { assertMatching, P } from '@diegogbrisa/ts-match'

const PROBE_TIMEOUT_MS = 5_000

function isQuery(value: unknown): value is () => Promise<unknown> {
  return typeof value === 'function'
}

/** Run against the exact rebuilt/packaged addon, with a live listener owned by this process. */
export async function probeWindowsTerminalTelemetry(pty: unknown) {
  assertMatching({ processTable: P.when(isQuery), listeningPorts: P.when(isQuery) }, pty)
  const server = createServer()
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Windows terminal telemetry probe timed out.')), PROBE_TIMEOUT_MS)
  })
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      }),
      deadline,
    ])
    const address = server.address()
    assertMatching({ port: P.number }, address)
    const [processes, listeners] = await Promise.race([
      Promise.all([pty.processTable(), pty.listeningPorts()]),
      deadline,
    ])
    assertMatching(P.array({ pid: P.number, ppid: P.number, startedAt: P.string, name: P.string }), processes)
    assertMatching(P.array({ pid: P.number, host: P.string, port: P.number }), listeners)
    if (!processes.some((row) => row.pid === process.pid && row.startedAt.length > 0)) {
      throw new Error('Windows terminal telemetry did not find its own process.')
    }
    if (!listeners.some((row) => row.pid === process.pid && row.host === '127.0.0.1' && row.port === address.port)) {
      throw new Error('Windows terminal telemetry did not find its own TCP listener.')
    }
  } finally {
    clearTimeout(timer)
    server.close()
  }
}
