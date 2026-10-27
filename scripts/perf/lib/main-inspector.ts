/** A minimal Chrome DevTools Protocol client for a Node inspector (the Electron main process). */
export interface CdpClient {
  readonly send: (method: string, params?: object) => Promise<unknown>
  readonly evaluate: (expression: string) => Promise<unknown>
  readonly close: () => void
}

const INSPECTOR_POLL_MS = 50

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function inspectorWebSocketUrl(port: number, deadline: number) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
      const targets: unknown = await response.json()
      const first: unknown = Array.isArray(targets) ? targets[0] : null
      const url = isRecord(first) ? first.webSocketDebuggerUrl : null
      if (typeof url === 'string') return url
    } catch {
      // The inspector is not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, INSPECTOR_POLL_MS))
  }
  throw new Error(`No Node inspector on port ${String(port)}.`)
}

export async function connectInspector(port: number, timeoutMs: number): Promise<CdpClient> {
  const socket = new WebSocket(await inspectorWebSocketUrl(port, Date.now() + timeoutMs))
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('Inspector connection failed.')), { once: true })
  })
  let nextId = 0
  const pending = new Map<number, (value: unknown) => void>()
  socket.addEventListener('message', (event) => {
    const message: unknown = JSON.parse(String(event.data))
    if (!isRecord(message) || typeof message.id !== 'number') return
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  const send = (method: string, params: object = {}) =>
    new Promise<unknown>((resolve) => {
      nextId += 1
      pending.set(nextId, resolve)
      socket.send(JSON.stringify({ id: nextId, method, params }))
    })
  const evaluate = async (expression: string) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const result = isRecord(response) ? response.result : null
    const remote = isRecord(result) ? result.result : null
    if (isRecord(result) && result.exceptionDetails) {
      throw new Error(`Main-process evaluation failed: ${JSON.stringify(result.exceptionDetails)}`)
    }
    return isRecord(remote) ? remote.value : undefined
  }
  return { send, evaluate, close: () => socket.close() }
}

/**
 * Wraps every `ipcMain.handle` handler and every renderer `send` of the main process so each
 * invoke records its channel, duration and response size (JSON characters), and each pushed
 * event its channel and payload size. Read with `IPC_LOG_READ`, reset with `IPC_LOG_RESET`.
 */
export const IPC_LOG_INSTALL = `(() => {
  if (globalThis.__owIpc) return true
  const { ipcMain, webContents } = process.mainModule.require('electron')
  const log = { invokes: [], sends: {} }
  globalThis.__owIpc = log
  const size = (value) => { try { return JSON.stringify(value)?.length ?? 0 } catch { return -1 } }
  const handlers = ipcMain._invokeHandlers
  for (const [channel, handler] of handlers) {
    handlers.set(channel, async (event, ...args) => {
      const startedAt = performance.now()
      const result = await handler(event, ...args)
      log.invokes.push({ channel, startedAt, ms: performance.now() - startedAt, bytes: size(result) })
      return result
    })
  }
  for (const contents of webContents.getAllWebContents()) {
    const send = contents.send.bind(contents)
    contents.send = (channel, ...args) => {
      const entry = (log.sends[channel] ??= { count: 0, bytes: 0 })
      entry.count += 1
      entry.bytes += size(args)
      return send(channel, ...args)
    }
  }
  return true
})()`

export const IPC_LOG_READ = 'JSON.stringify(globalThis.__owIpc ?? null)'
export const IPC_LOG_RESET =
  '(() => { if (globalThis.__owIpc) { globalThis.__owIpc.invokes = []; globalThis.__owIpc.sends = {} } return true })()'
