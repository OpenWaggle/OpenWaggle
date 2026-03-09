import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createLoggerMock, debugMock, infoMock, warnMock, errorMock } = vi.hoisted(() => ({
  createLoggerMock: vi.fn(),
  debugMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}))

vi.mock('../../logger', () => ({
  createLogger: createLoggerMock,
}))

import { AppLogger } from '../logger-service'

describe('AppLogger.Live', () => {
  beforeEach(() => {
    createLoggerMock.mockReset()
    debugMock.mockReset()
    infoMock.mockReset()
    warnMock.mockReset()
    errorMock.mockReset()
    createLoggerMock.mockImplementation(() => ({
      debug: debugMock,
      info: infoMock,
      warn: warnMock,
      error: errorMock,
    }))
  })

  it('delegates info logging to the namespace logger', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* AppLogger
        yield* logger.info('ipc', 'message', { value: 1 })
      }).pipe(Effect.provide(AppLogger.Live)),
    )

    expect(createLoggerMock).toHaveBeenCalledWith('ipc')
    expect(infoMock).toHaveBeenCalledWith('message', { value: 1 })
  })

  it('delegates debug, warn, and error logging to the namespace logger', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* AppLogger
        yield* logger.debug('agent', 'debugging')
        yield* logger.warn('agent', 'warning')
        yield* logger.error('agent', 'failure')
      }).pipe(Effect.provide(AppLogger.Live)),
    )

    expect(createLoggerMock).toHaveBeenCalledWith('agent')
    expect(debugMock).toHaveBeenCalledWith('debugging', undefined)
    expect(warnMock).toHaveBeenCalledWith('warning', undefined)
    expect(errorMock).toHaveBeenCalledWith('failure', undefined)
  })
})
