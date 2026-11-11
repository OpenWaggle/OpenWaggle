import { describe, it } from 'vitest'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { desktopDialogsContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-dialogs.contract'
import { desktopMenusContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-menus.contract'
import { desktopWindowsContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-windows.contract'
import { osShellContract } from '../../../../ports/desktop-shell/__tests__/contracts/os-shell.contract'
import { systemNotificationsContract } from '../../../../ports/desktop-shell/__tests__/contracts/system-notifications.contract'
import { prepareElectronShell } from './electron-shell'

/** One test per contract case, each against a freshly prepared Electron shell. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electron)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

async function prepareWindows() {
  const shell = await prepareElectronShell()
  const { createBrowserWindow, desktopWindowOf } = shell.windowPolicy
  return { ...shell, openWindow: () => desktopWindowOf(createBrowserWindow({ show: false })) }
}

runContract(desktopWindowsContract, async () => {
  const { windowPolicy, openWindow, enterAutomation } = await prepareWindows()
  const { electronDesktopWindows } = await import('../../electron-desktop-windows')
  return {
    subject: electronDesktopWindows,
    openWindow,
    isVisible: (window) => windowPolicy.electronWindowOf(window)?.isVisible() ?? false,
    minimize: (window) => windowPolicy.electronWindowOf(window)?.minimize(),
    enterAutomation,
  }
})

runContract(desktopDialogsContract, async () => {
  const { electron, openWindow, enterAutomation } = await prepareWindows()
  const { electronDialogs } = await import('../../electron-dialogs')
  return {
    subject: electronDialogs,
    openWindow,
    answerNext: ({ button, paths }) => {
      electron.dialogState.response = button
      electron.dialogState.filePaths = [...paths]
    },
    dialogOwnerIds: () => electron.dialogState.owners.map((owner) => owner?.id ?? null),
    enterAutomation,
  }
})

runContract(desktopMenusContract, async () => {
  const { electron, openWindow, enterAutomation } = await prepareWindows()
  const { electronMenus } = await import('../../electron-menus')
  return {
    subject: electronMenus,
    openWindow,
    applicationMenuLabels: () =>
      electron.menus.applicationMenu?.template.map((item) => item.label ?? '') ?? null,
    chooseInLastContextMenu: (label) => {
      const item = electron.lastPopup.current?.menu.template.find((entry) => entry.label === label)
      item?.click?.()
      return item !== undefined
    },
    enterAutomation,
  }
})

runContract(osShellContract, async () => {
  const { electron, enterAutomation } = await prepareElectronShell()
  const { electronOsShell } = await import('../../electron-os-shell')
  return {
    subject: electronOsShell,
    handedToSystem: () => electron.shellState.handed,
    enterAutomation,
  }
})

runContract(systemNotificationsContract, async () => {
  const { electron, enterAutomation } = await prepareElectronShell()
  const { electronSystemNotifications } = await import('../../electron-system-notifications')
  return {
    subject: electronSystemNotifications,
    shownTitles: () => electron.notifications.shown.map((shown) => String(shown.options.title)),
    clickLast: () => electron.notifications.shown.at(-1)?.emit('click'),
    enterAutomation,
  }
})
