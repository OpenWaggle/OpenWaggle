import { homedir } from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import sharp from 'sharp'
import { describe, it, vi } from 'vitest'
import type { DesktopWindow } from '../../../../ports/desktop-shell/desktop-windows'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { PRODUCT_NAME } from '@shared/build-identity-runtime'
import { readEnvironmentVariables } from '../../../../env'
import { appLifecycleContract } from '../../../../ports/desktop-shell/__tests__/contracts/app-lifecycle.contract'
import { appPathsContract } from '../../../../ports/desktop-shell/__tests__/contracts/app-paths.contract'
import { childScriptRuntimeContract } from '../../../../ports/desktop-shell/__tests__/contracts/child-script-runtime.contract'
import { clipboardContract } from '../../../../ports/desktop-shell/__tests__/contracts/clipboard.contract'
import { desktopDialogsContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-dialogs.contract'
import { desktopMenusContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-menus.contract'
import { osShellContract } from '../../../../ports/desktop-shell/__tests__/contracts/os-shell.contract'
import { systemNotificationsContract } from '../../../../ports/desktop-shell/__tests__/contracts/system-notifications.contract'
import { prepareElectrobunShell } from './electrobun-shell'

/** One test per contract case, each against a freshly prepared Electrobun shell. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electrobun)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

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
