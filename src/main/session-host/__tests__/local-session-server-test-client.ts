import net, { type Socket } from 'node:net'
import { LocalSessionFrameDecoder } from '../local-session-framing'

export class TestFrameReader {
  private readonly decoder = new LocalSessionFrameDecoder()
  private readonly values: unknown[] = []
  private readonly waiters: ((value: unknown) => void)[] = []

  constructor(socket: Socket) {
    socket.on('data', (chunk) => {
      for (const value of this.decoder.push(chunk)) {
        const waiter = this.waiters.shift()
        if (waiter) waiter(value)
        else this.values.push(value)
      }
    })
  }

  next(): Promise<unknown> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve(value)
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

export function connectLocalSessionTestClient(endpoint: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}
