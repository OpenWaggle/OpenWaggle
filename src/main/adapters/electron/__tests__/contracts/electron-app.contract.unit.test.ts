import { describe, it } from 'vitest'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { BUILD_CHANNEL, PRODUCT_NAME } from '@shared/build-identity-runtime'
import { appLifecycleContract } from '../../../../ports/desktop-shell/__tests__/contracts/app-lifecycle.contract'
import { appPathsContract } from '../../../../ports/desktop-shell/__tests__/contracts/app-paths.contract'
import { childScriptRuntimeContract } from '../../../../ports/desktop-shell/__tests__/contracts/child-script-runtime.contract'
import { clipboardContract } from '../../../../ports/desktop-shell/__tests__/contracts/clipboard.contract'
import { secureStorageContract } from '../../../../ports/desktop-shell/__tests__/contracts/secure-storage.contract'
import { systemIntegrationContract } from '../../../../ports/desktop-shell/__tests__/contracts/system-integration.contract'
import { updateEngineContract } from '../../../../ports/desktop-shell/__tests__/contracts/update-engine.contract'
import { FAKE_PNG } from './fake-electron'
import { prepareElectronShell } from './electron-shell'

/** One test per contract case, each against a freshly prepared Electron shell. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electron)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

runContract(appPathsContract, async () => {
  await prepareElectronShell()
  const { electronAppPaths } = await import('../../electron-app-paths')
  const name = BUILD_CHANNEL === 'dev' ? PRODUCT_NAME : 'openwaggle'
  return { subject: electronAppPaths, buildUserData: `/fake/Application Support/${name}` }
})

runContract(appLifecycleContract, async () => {
  const { electron } = await prepareElectronShell()
  const { electronAppLifecycle } = await import('../../electron-app-lifecycle')
  return {
    subject: electronAppLifecycle,
    completedQuits: () => electron.app.quits,
    announceQuitForUpdate: () => electron.autoUpdater.emit('before-quit-for-update'),
  }
})

runContract(childScriptRuntimeContract, async () => {
  await prepareElectronShell()
  const { electronChildScriptRuntime } = await import('../../electron-child-script-runtime')
  // Under Vitest the executable is Node, which runs a script whatever ELECTRON_RUN_AS_NODE says.
  return { subject: electronChildScriptRuntime, canSpawn: true }
})

runContract(secureStorageContract, async () => {
  const { electron } = await prepareElectronShell()
  const { electronSecureStorage } = await import('../../electron-secure-storage')
  return {
    subject: electronSecureStorage,
    makeUnavailable: () => void (electron.safeStorageState.available = false),
  }
})

runContract(clipboardContract, async () => {
  const { electron } = await prepareElectronShell()
  const { electronClipboard } = await import('../../electron-clipboard')
  return {
    subject: electronClipboard,
    encodedImage: FAKE_PNG,
    holdsImage: () => electron.clipboardState.image !== null,
  }
})

runContract(systemIntegrationContract, async () => {
  const { electron } = await prepareElectronShell()
  const { electronSystemIntegration } = await import('../../electron-system-integration')
  return {
    subject: electronSystemIntegration,
    anotherInstanceRuns: () => void (electron.app.lockHeldByAnother = true),
    launchAgain: (launch) =>
      electron.app.emit(
        'second-instance',
        {},
        [...launch.argv],
        launch.workingDirectory,
        launch.additionalData,
      ),
    wakeFromSleep: () => electron.powerMonitor.emit('resume'),
    openUrl: (url) => electron.app.emit('open-url', { preventDefault: () => undefined }, url),
  }
})

runContract(updateEngineContract, async () => {
  const { updater } = await prepareElectronShell()
  const { electronUpdateEngine } = await import('../../electron-update-engine')
  const engine = updater.autoUpdater
  return {
    subject: electronUpdateEngine,
    offerOnNextCheck: (version) => void (engine.offered = version),
    engineReports: {
      available: (version) => engine.emit('update-available', { version }),
      progress: (percent) => engine.emit('download-progress', { percent }),
      downloaded: (version) => engine.emit('update-downloaded', { version }),
      failed: (error) => engine.emit('error', error),
    },
    installsOnQuit: () => engine.autoInstallOnAppQuit,
    installs: () => engine.installs,
    downloadCancelled: () => engine.downloadCancelled,
  }
})
