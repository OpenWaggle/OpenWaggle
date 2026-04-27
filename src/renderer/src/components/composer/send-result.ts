import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('composer')

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

export function consumeSendResult(result: Promise<void> | void): void {
  if (!isPromiseLike(result)) {
    return
  }

  result.catch((error) => {
    logger.error('Composer send failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
