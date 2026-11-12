import type { Socket } from 'node:net'
import type { SessionHostRefusalCode } from '@shared/domain/session-host-refusals'
import {
  LocalSessionInboundCapacityError,
  type LocalSessionInboundRetention,
} from './local-session-inbound-retention'
import { MAX_DECODED_FRAMES_PER_CHUNK } from './local-session-resource-policy'
import { describeLocalSessionServerError } from './local-session-server-frame'

interface LocalSessionConnectionInputOptions {
  readonly socket: Socket
  readonly inbound: LocalSessionInboundRetention
  readonly closed: () => boolean
  readonly handleValue: (value: unknown) => Promise<void>
  readonly failed: (code: SessionHostRefusalCode, message: string) => Promise<void>
}

export function bindLocalSessionConnectionInput(options: LocalSessionConnectionInputOptions) {
  let readTail = Promise.resolve()
  options.socket.on('data', (chunk) => {
    options.socket.pause()
    try {
      const batch = options.inbound.push(chunk, MAX_DECODED_FRAMES_PER_CHUNK)
      readTail = readTail
        .then(async () => {
          for (const value of batch.values) {
            if (options.closed()) break
            await options.handleValue(value)
          }
        })
        .catch((error: unknown) =>
          options.failed('protocol_error', describeLocalSessionServerError(error)),
        )
        .finally(() => {
          batch.release()
          if (!options.closed()) options.socket.resume()
        })
    } catch (error) {
      const code =
        error instanceof LocalSessionInboundCapacityError
          ? 'inbound_backpressure_exceeded'
          : 'invalid_frame'
      void options.failed(code, describeLocalSessionServerError(error))
    }
  })
}
