import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { DesktopWindow, DesktopWindowsShape } from '../../desktop-windows'
import { AUTOMATION_BLOCKED } from './automation'

export interface DesktopWindowsContractHarness {
  readonly subject: DesktopWindowsShape
  /** A window the app opened through its own (adapter-internal) path, initially hidden. */
  readonly openWindow: () => DesktopWindow
  readonly isVisible: (window: DesktopWindow) => boolean
  readonly minimize: (window: DesktopWindow) => void
  readonly enterAutomation: () => void
}

export const desktopWindowsContract = definePortContract<DesktopWindowsContractHarness>(
  'DesktopWindows',
  {
    'lists open windows and finds the window of a page': async ({ subject, openWindow }) => {
      const first = openWindow()
      const second = openWindow()
      expect(subject.all().map((window) => window.id)).toEqual([first.id, second.id])
      expect(subject.fromSurface(second.webContents)?.id).toBe(second.id)
    },

    'reveals, restores and focuses a window': async ({
      subject,
      openWindow,
      isVisible,
      minimize,
    }) => {
      const window = openWindow()
      subject.revealInactive(window)
      expect(isVisible(window)).toBe(true)
      minimize(window)
      subject.focus(window)
      expect(subject.focused()?.id).toBe(window.id)
    },

    'never shows or focuses a window under automation': async ({
      subject,
      openWindow,
      isVisible,
      enterAutomation,
    }) => {
      const window = openWindow()
      enterAutomation()
      expect(() => subject.reveal(window)).toThrow(expect.objectContaining(AUTOMATION_BLOCKED))
      expect(() => subject.revealInactive(window)).toThrow(
        expect.objectContaining(AUTOMATION_BLOCKED),
      )
      expect(() => subject.focus(window)).toThrow(expect.objectContaining(AUTOMATION_BLOCKED))
      expect(() =>
        subject.setOverlayIcon(window, { pixels: Buffer.alloc(4), width: 1, height: 1 }, 'one'),
      ).not.toThrow()
      expect(isVisible(window)).toBe(false)
    },
  },
)
