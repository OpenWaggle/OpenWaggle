import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import sharp from 'sharp'
import { afterEach, describe, it, vi } from 'vitest'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import type { DesktopWindow } from '../../../../ports/desktop-shell/desktop-windows'
import { PRODUCT_NAME } from '@shared/build-identity-runtime'
import { readEnvironmentVariables } from '../../../../env'
import { appLifecycleContract } from '../../../../ports/desktop-shell/__tests__/contracts/app-lifecycle.contract'
import { appPathsContract } from '../../../../ports/desktop-shell/__tests__/contracts/app-paths.contract'
import { childScriptRuntimeContract } from '../../../../ports/desktop-shell/__tests__/contracts/child-script-runtime.contract'
import { clipboardContract } from '../../../../ports/desktop-shell/__tests__/contracts/clipboard.contract'
import { desktopDialogsContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-dialogs.contract'
import { desktopMenusContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-menus.contract'
import { osShellContract } from '../../../../ports/desktop-shell/__tests__/contracts/os-shell.contract'
import { systemIntegrationContract } from '../../../../ports/desktop-shell/__tests__/contracts/system-integration.contract'
import { systemNotificationsContract } from '../../../../ports/desktop-shell/__tests__/contracts/system-notifications.contract'
import { prepareElectrobunShell } from './electrobun-shell'

const profiles: string[] = []

afterEach(async () => {
  for (const profile of profiles.splice(0)) await rm(profile, { recursive: true, force: true })
})

/** Electrobun windows are numbered; the windows adapter hands out their ids as `DesktopWindow.id`. */
function fakeWindow(id: number): DesktopWindow {
  return fromPartial({ id, isDestroyed: () => false })
}

/** Electron's userData for a Dev build under test, which the Electrobun adapter must match. */
function devUserData() {
  const { APPDATA, XDG_CONFIG_HOME } = readEnvironmentVariables(['APPDATA', 'XDG_CONFIG_HOME'])
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', PRODUCT_NAME)
  }
  if (process.platform === 'win32') {
    return path.join(APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), PRODUCT_NAME)
  }
  return path.join(XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), PRODUCT_NAME)
}

/** One test per contract case, each against a fresh harness of the Electrobun adapter. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electrobun)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

runContract(appPathsContract, async () => {
  await prepareElectrobunShell()
  const { electrobunAppPaths } = await import('../../electrobun-app-paths')
  return { subject: electrobunAppPaths, buildUserData: devUserData() }
})

runContract(appLifecycleContract, async () => {
  const { electrobun } = await prepareElectrobunShell()
  const { electrobunAppLifecycle } = await import('../../electrobun-app-lifecycle')
  const { emitShellEvent } = await import('../../electrobun-shell-events')
  return {
    subject: electrobunAppLifecycle,
    completedQuits: () => electrobun.lifecycleState.quits,
    announceQuitForUpdate: () => emitShellEvent('before-quit-for-update'),
  }
})

runContract(childScriptRuntimeContract, async () => {
  await prepareElectrobunShell()
  const { electrobunChildScriptRuntime } = await import('../../electrobun-child-script-runtime')
  // Vitest runs on Bun, the runtime Electrobun ships.
  return { subject: electrobunChildScriptRuntime, canSpawn: true }
})

runContract(clipboardContract, async () => {
  const { electrobun } = await prepareElectrobunShell()
  const { electrobunClipboard } = await import('../../electrobun-clipboard')
  const pixel = { width: 1, height: 1, channels: 4, background: '#000000ff' } as const
  return {
    subject: electrobunClipboard,
    encodedImage: new Uint8Array(await sharp({ create: pixel }).webp().toBuffer()),
    holdsImage: () => electrobun.clipboardState.image !== null,
  }
})

runContract(osShellContract, async () => {
  const { electrobun, enterAutomation } = await prepareElectrobunShell()
  const { electrobunOsShell } = await import('../../electrobun-os-shell')
  return {
    subject: electrobunOsShell,
    handedToSystem: () => electrobun.shellState.handed,
    enterAutomation,
  }
})

runContract(desktopDialogsContract, async () => {
  const { electrobun, enterAutomation } = await prepareElectrobunShell()
  // The save panel is another process the OS shows; it answers like the other dialogs here.
  vi.doMock('../../electrobun-save-dialog', () => ({
    showNativeSaveDialog: async () => {
      electrobun.dialogState.owners.push(electrobun.dialogState.raisedWindows.pop() ?? null)
      return electrobun.dialogState.answer.paths[0] ?? null
    },
  }))
  const { electrobunDialogs } = await import('../../electrobun-dialogs')
  return {
    subject: electrobunDialogs,
    openWindow: () => fakeWindow(1),
    answerNext: (answer) => void (electrobun.dialogState.answer = answer),
    dialogOwnerIds: () => electrobun.dialogState.owners,
    enterAutomation,
  }
})

runContract(desktopMenusContract, async () => {
  const { electrobun, enterAutomation } = await prepareElectrobunShell()
  const { electrobunMenus } = await import('../../electrobun-menus')
  return {
    subject: electrobunMenus,
    openWindow: () => fakeWindow(1),
    applicationMenuLabels: () =>
      electrobun.menuState.application?.map((item) => item.label ?? '') ?? null,
    chooseInLastContextMenu: electrobun.chooseInContextMenu,
    enterAutomation,
  }
})

runContract(systemNotificationsContract, async () => {
  const { electrobun, enterAutomation } = await prepareElectrobunShell()
  const { electrobunSystemNotifications } = await import('../../electrobun-system-notifications')
  return {
    subject: electrobunSystemNotifications,
    shownTitles: () => electrobun.shownNotifications,
    // Clicking a notification brings the app back: its window gains focus.
    clickLast: () => void electrobun.emit('focus', { id: 1 }),
    enterAutomation,
  }
})

runContract(systemIntegrationContract, async () => {
  const { electrobun } = await prepareElectrobunShell()
  const profile = await mkdtemp(path.join(tmpdir(), 'openwaggle-instance-'))
  profiles.push(profile)
  const { electrobunAppPaths } = await import('../../electrobun-app-paths')
  electrobunAppPaths.setUserData(profile)
  // The registry is the Windows login-item store; a test never writes the machine's Run key.
  const registry = new Map<string, string>()
  vi.doMock('../../electrobun-windows-registry', () => ({
    readRegistryString: (key: string, name: string | null) =>
      registry.get(`${key}\\${String(name)}`) ?? null,
    writeRegistryString: (key: string, name: string | null, value: string) =>
      void registry.set(`${key}\\${String(name)}`, value),
    deleteRegistryValue: (key: string, name: string) => void registry.delete(`${key}\\${name}`),
  }))
  const { electrobunSystemIntegration } = await import('../../electrobun-system-integration')
  const { receiveSecondInstance } = await import('../../electrobun-single-instance')
  const { emitShellEvent } = await import('../../electrobun-shell-events')
  return {
    subject: electrobunSystemIntegration,
    // The parent of this test process is alive for as long as the test runs.
    anotherInstanceRuns: () =>
      writeFileSync(path.join(profile, 'openwaggle-instance.lock'), String(process.ppid)),
    launchAgain: receiveSecondInstance,
    wakeFromSleep: () => emitShellEvent('resume'),
    openUrl: (url) => void electrobun.emit('open-url', { url }),
  }
})
