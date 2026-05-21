import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('composer')

function isPromiseResult(value: Promise<void> | void): value is Promise<void> {
  return value !== undefined
}

export function consumeSendResult(result: Promise<void> | void): void {
  if (!isPromiseResult(result)) {
    return
  }

  result.catch((error) => {
    logger.error('Composer send failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
