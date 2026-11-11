import { describe, it } from 'vitest'
import { updateEngineContract } from '../../../../ports/desktop-shell/__tests__/contracts/update-engine.contract'
import { prepareElectrobunShell } from './electrobun-shell'

describe(`${updateEngineContract.port} contract (Electrobun)`, () => {
  it.for(Object.entries(updateEngineContract.cases))('%s', async ([, check]) => {
    const { electrobun } = await prepareElectrobunShell()
    const { electrobunUpdateEngine } = await import('../../electrobun-update-engine')
    const { updater } = electrobun
    await check({
      subject: electrobunUpdateEngine,
      offerOnNextCheck: updater.offer,
      engineReports: {
        available: updater.reportAvailable,
        progress: updater.reportProgress,
        downloaded: updater.reportDownloaded,
        failed: (error) => updater.reportError(error.message),
      },
      // Electrobun installs only when asked, so anything applied before that was scheduled.
      installsOnQuit: () => updater.state.applies > 0,
      // Electrobun always installs silently and relaunches the app.
      installs: () =>
        Array.from({ length: updater.state.applies }, () => ({ silent: true, relaunch: true })),
      downloadCancelled: () => updater.state.downloadsStarted === 0,
    })
  })
})
