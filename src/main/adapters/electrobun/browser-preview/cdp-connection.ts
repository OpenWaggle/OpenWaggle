import { parseJsonUnknown, safeDecodeUnknown, Schema } from '@shared/schema'
import { createLogger } from '../../../logger'

const logger = createLogger('electrobun-browser-preview-cdp')

/** A WebSocket as the CDP client uses it; the Web `WebSocket` has this shape. */
export interface CdpSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
}

export type CdpSocketFactory = (url: string) => CdpSocket

export type CdpEventListener = (method: string, params: unknown) => void

const CdpMessageSchema = Schema.Struct({
  id: Schema.optional(Schema.Number),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
})

interface PendingCommand {
  readonly method: string
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

function decodeMessage(data: string) {
  try {
    return safeDecodeUnknown(CdpMessageSchema, parseJsonUnknown(data))
  } catch {
    return null
  }
}

/** The Web `WebSocket` of the runtime (Bun's in the Electrobun main process). */
export const openWebSocket: CdpSocketFactory = (url) => new WebSocket(url)

/**
 * One Chrome DevTools Protocol session over a page target's WebSocket: commands with a bounded
 * deadline each, and events to listeners. Closing it, or the socket closing, rejects every pending
 * command; nothing is retried here.
 */
export class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<number, PendingCommand>()
  private readonly listeners = new Set<CdpEventListener>()
  private readonly closeListeners = new Set<() => void>()
  private open = true

  private readonly socket: CdpSocket
  private readonly commandTimeoutMs: number

  private constructor(socket: CdpSocket, commandTimeoutMs: number) {
    this.socket = socket
    this.commandTimeoutMs = commandTimeoutMs
    socket.addEventListener('message', (event) => this.receive(event.data))
    socket.addEventListener('close', () => this.shutDown('The CDP connection closed.'))
  }

  static connect(
    url: string,
    options: { readonly openSocket: CdpSocketFactory; readonly commandTimeoutMs: number },
  ): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = options.openSocket(url)
      let settled = false
      socket.addEventListener('open', () => {
        settled = true
        resolve(new CdpConnection(socket, options.commandTimeoutMs))
      })
      const fail = () => {
        if (settled) return
        settled = true
        reject(new Error('The CDP WebSocket could not connect.'))
      }
      socket.addEventListener('error', fail)
      socket.addEventListener('close', fail)
    })
  }

  get isOpen(): boolean {
    return this.open
  }

  send(method: string, params: object = {}): Promise<unknown> {
    if (!this.open) return Promise.reject(new Error(`${method}: the CDP connection is closed.`))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, this.commandTimeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (cause) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`${method} could not be sent.`, { cause }))
      }
    })
  }

  onEvent(listener: CdpEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(): void {
    if (!this.open) return
    this.shutDown('The CDP connection was closed.')
    try {
      this.socket.close()
    } catch {
      // The socket is already gone; every pending command was rejected above.
    }
  }

  private receive(data: unknown) {
    const decoded = typeof data === 'string' ? decodeMessage(data) : null
    if (decoded === null || !decoded.success) {
      logger.warn('Ignored a malformed CDP message', { bytes: String(data).length })
      return
    }
    const message = decoded.data
    if (message.id !== undefined) {
      const command = this.pending.get(message.id)
      if (command === undefined) return
      this.pending.delete(message.id)
      clearTimeout(command.timer)
      if (message.error) command.reject(new Error(`${command.method}: ${message.error.message}`))
      else command.resolve(message.result ?? {})
      return
    }
    if (message.method === undefined) return
    for (const listener of this.listeners) listener(message.method, message.params)
  }

  private shutDown(reason: string) {
    if (!this.open) return
    this.open = false
    for (const [id, command] of this.pending) {
      clearTimeout(command.timer)
      this.pending.delete(id)
      command.reject(new Error(`${command.method}: ${reason}`))
    }
    for (const listener of this.closeListeners) listener()
  }
}
