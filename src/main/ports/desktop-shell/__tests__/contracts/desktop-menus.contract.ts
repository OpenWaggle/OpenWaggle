import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { DesktopWindow } from '../../desktop-windows'
import type { DesktopMenusShape, ShellMenuItem } from '../../menus'
import { AUTOMATION_BLOCKED } from './automation'

export interface DesktopMenusContractHarness {
  readonly subject: DesktopMenusShape
  readonly openWindow: () => DesktopWindow
  /** The labels of the application menu's top-level items, or `null` without one. */
  readonly applicationMenuLabels: () => readonly string[] | null
  /** Chooses the item labelled `label` in the context menu that opened last; false if none did. */
  readonly chooseInLastContextMenu: (label: string) => boolean
  readonly enterAutomation: () => void
}

export const desktopMenusContract = definePortContract<DesktopMenusContractHarness>(
  'DesktopMenus',
  {
    'sets and removes the application menu': async ({ subject, applicationMenuLabels }) => {
      subject.setApplicationMenu([
        { label: 'OpenWaggle', submenu: [{ role: 'quit' }] },
        { label: 'Edit', submenu: [{ role: 'copy' }, { type: 'separator' }, { role: 'paste' }] },
      ])
      expect(applicationMenuLabels()).toEqual(['OpenWaggle', 'Edit'])
      subject.setApplicationMenu(null)
      expect(applicationMenuLabels()).toBeNull()
    },

    'runs the action of the context menu item the user chose': async ({
      subject,
      openWindow,
      chooseInLastContextMenu,
    }) => {
      const chosen: string[] = []
      const items: ShellMenuItem[] = [
        { label: 'Copy link', click: () => chosen.push('copy') },
        { label: 'Open', click: () => chosen.push('open') },
      ]
      subject.popupContextMenu(openWindow(), items)
      expect(chooseInLastContextMenu('Open')).toBe(true)
      expect(chosen).toEqual(['open'])
    },

    'opens no context menu under automation': async ({
      subject,
      openWindow,
      chooseInLastContextMenu,
      enterAutomation,
    }) => {
      const window = openWindow()
      enterAutomation()
      expect(() => subject.popupContextMenu(window, [{ label: 'Open' }])).toThrow(
        expect.objectContaining(AUTOMATION_BLOCKED),
      )
      expect(chooseInLastContextMenu('Open')).toBe(false)
    },
  },
)
