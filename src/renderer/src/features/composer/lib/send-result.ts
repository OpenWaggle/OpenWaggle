import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('composer')

function isPromiseResult(value: unknown): value is Promise<unknown> {
  return value instanceof Promise
}

/** A send refused for a reason the user is already shown: worth a warning, not an error. */
export function logExpectedSendRefusal(cause: unknown) {
  logger.warn('Composer send was refused', {
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

export function consumeSendResult(result: unknown): void {
  if (!isPromiseResult(result)) {
    return
  }

  result.catch((error) => {
    logger.error('Composer send failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
