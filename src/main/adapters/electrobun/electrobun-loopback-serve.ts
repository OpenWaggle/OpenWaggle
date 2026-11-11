/**
 * The one Bun API the loopback trusted origins need: `Bun.serve` on `127.0.0.1`. TypeScript does
 * not type the `Bun` global here (`types` stays empty, ADR 0064), so this reads it at call time
 * and checks the narrow shape it uses.
 */
export interface LoopbackServer {
  readonly port: number
  /** Stops listening and closes open connections. */
  readonly stop: () => void
}

export interface LoopbackServeOptions {
  /** `0` lets the system choose a free port. */
  readonly port: number
  readonly fetch: (request: Request) => Response | Promise<Response>
}

export type LoopbackServe = (options: LoopbackServeOptions) => LoopbackServer

export const LOOPBACK_HOSTNAME = '127.0.0.1'

function runtimeServe() {
  const bun: unknown = Reflect.get(globalThis, 'Bun')
  const serve: unknown =
    typeof bun === 'object' && bun !== null ? Reflect.get(bun, 'serve') : undefined
  if (typeof serve !== 'function') {
    throw new Error('Loopback trusted origins need the Bun runtime (Bun.serve).')
  }
  return { bun, serve }
}

/** `Bun.serve` bound to the loopback interface; throws when the port is taken. */
export const bunLoopbackServe: LoopbackServe = (options) => {
  const { bun, serve } = runtimeServe()
  const server: unknown = Reflect.apply(serve, bun, [
    { hostname: LOOPBACK_HOSTNAME, port: options.port, fetch: options.fetch },
  ])
  const port: unknown = typeof server === 'object' ? Reflect.get(server ?? {}, 'port') : undefined
  const stop: unknown = typeof server === 'object' ? Reflect.get(server ?? {}, 'stop') : undefined
  if (typeof port !== 'number' || typeof stop !== 'function') {
    throw new Error('Bun.serve returned no listening server.')
  }
  return { port, stop: () => void Reflect.apply(stop, server, [true]) }
}
