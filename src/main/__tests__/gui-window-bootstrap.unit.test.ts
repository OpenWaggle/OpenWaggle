import { describe, expect, it } from 'vitest'
import { openWindowThenRegisterIpc } from '../gui-window-bootstrap'

describe('openWindowThenRegisterIpc', () => {
  it('opens the window after its protocols and before the IPC handlers load (W11)', async () => {
    const steps: string[] = []

    await openWindowThenRegisterIpc({
      registerProtocols: () => steps.push('protocols'),
      createWindow: () => steps.push('window'),
      registerIpc: async () => {
        await Promise.resolve()
        steps.push('ipc')
      },
      startupMark: (label) => steps.push(`mark:${label}`),
    })

    expect(steps).toEqual([
      'protocols',
      'mark:protocol-handlers-registered',
      'window',
      'mark:main-window-created',
      'ipc',
      'mark:ipc-handlers-registered',
    ])
  })

  it('registers microtask-loaded handlers before the next message could be handled', async () => {
    const order: string[] = []
    setTimeout(() => order.push('next message'), 0)

    await openWindowThenRegisterIpc({
      registerProtocols: () => undefined,
      createWindow: () => order.push('window'),
      // Bundled dynamic imports resolve in microtasks.
      registerIpc: () =>
        Promise.resolve().then(() => {
          order.push('handlers')
        }),
      startupMark: () => undefined,
    })

    expect(order).toEqual(['window', 'handlers'])
  })
})
