import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('composer')

function isPromiseResult(value: unknown): value is Promise<unknown> {
  return value instanceof Promise
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
