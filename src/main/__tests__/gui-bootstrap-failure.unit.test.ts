import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    reportErrorBeforeExit: vi.fn(async (_error: unknown, _process: string) => {
      order.push('report-error')
    }),
  }
})

vi.mock('../error-reporting', () => ({ reportErrorBeforeExit: mocks.reportErrorBeforeExit }))
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { exitAfterBootstrapFailure } from '../gui-bootstrap-failure'

describe('GUI bootstrap failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.order.length = 0
  })

  it('reports the error, cleans up and exits with a failure code', async () => {
    const error = new Error('Session Host did not start')
    const exit = vi.fn((_code: number) => void mocks.order.push('exit'))
    const cleanupDesktopServices = vi.fn(async () => void mocks.order.push('cleanup'))

    await exitAfterBootstrapFailure({
      error,
      cliSetup: Promise.resolve(),
      cleanupDesktopServices,
      exit,
    })

    expect(mocks.reportErrorBeforeExit).toHaveBeenCalledWith(error, 'gui')
    expect(cleanupDesktopServices).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
    expect(mocks.order.at(-1)).toBe('exit')
    expect(mocks.order).toContain('report-error')
  })

  it('still reports and exits when cleanup fails', async () => {
    const error = new Error('window failed')
    const exit = vi.fn()

    await exitAfterBootstrapFailure({
      error,
      cliSetup: Promise.reject(new Error('CLI setup failed')),
      cleanupDesktopServices: async () => {
        throw new Error('cleanup failed')
      },
      exit,
    })

    expect(mocks.reportErrorBeforeExit).toHaveBeenCalledWith(error, 'gui')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('waits for the report before exiting', async () => {
    const report = Promise.withResolvers<void>()
    mocks.reportErrorBeforeExit.mockImplementationOnce(() => report.promise)
    const exit = vi.fn()

    const exited = exitAfterBootstrapFailure({
      error: new Error('failed'),
      cliSetup: Promise.resolve(),
      cleanupDesktopServices: async () => undefined,
      exit,
    })
    await vi.waitFor(() => expect(mocks.reportErrorBeforeExit).toHaveBeenCalledOnce())

    expect(exit).not.toHaveBeenCalled()
    report.resolve()
    await exited
    expect(exit).toHaveBeenCalledWith(1)
  })
})
