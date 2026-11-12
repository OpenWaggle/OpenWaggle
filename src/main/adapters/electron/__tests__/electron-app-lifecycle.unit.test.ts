import { describe, expect, it } from 'vitest'
import { prepareElectronShell } from './contracts/electron-shell'

describe('electronAppLifecycle.disableHardwareAcceleration', () => {
  it('turns GPU compositing off and folds the GPU and network service helpers into the process', async () => {
    const { electron } = await prepareElectronShell()
    const { electronAppLifecycle } = await import('../electron-app-lifecycle')

    electronAppLifecycle.disableHardwareAcceleration()

    expect(electron.app.hardwareAccelerationDisabled).toBe(true)
    expect(Object.fromEntries(electron.app.switches)).toEqual({
      'in-process-gpu': '',
      'enable-features': 'NetworkServiceInProcess2',
    })
  })
})
