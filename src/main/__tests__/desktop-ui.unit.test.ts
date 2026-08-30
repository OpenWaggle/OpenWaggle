import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  class BaseWindow {
    readonly options: { readonly show?: boolean }

    constructor(options: { readonly show?: boolean } = {}) {
      this.options = options
    }

    focus() {}
    isVisible() {
      return this.options.show ?? true
    }
    restore() {}
    show() {}
    showInactive() {}
  }

  class BrowserWindow extends BaseWindow {
    static getAllWindows() {
      return []
    }
  }

  return {
    BaseWindow,
    BrowserWindow,
    dialog: {
      showCertificateTrustDialog: vi.fn(),
      showErrorBox: vi.fn(),
      showMessageBox: vi.fn(),
      showMessageBoxSync: vi.fn(),
      showOpenDialog: vi.fn(),
      showOpenDialogSync: vi.fn(),
      showSaveDialog: vi.fn(),
      showSaveDialogSync: vi.fn(),
    },
    shell: {
      beep: vi.fn(),
      openExternal: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
      trashItem: vi.fn(),
    },
  }
})

vi.mock('electron', () => electronMocks)
vi.mock('../env', () => ({ env: { OPENWAGGLE_AUTOMATION: '1' } }))

import {
  AutomationDesktopUiError,
  createBaseWindow,
  createBrowserWindow,
  installAutomationDesktopUiBlockers,
  openExternal,
  openPath,
  showItemInFolder,
  showMessageBox,
  trashItem,
} from '../desktop-ui'

describe('automation desktop UI policy', () => {
  beforeEach(() => {
    electronMocks.dialog.showMessageBox = vi.fn()
    electronMocks.shell.openExternal = vi.fn()
  })

  it('fails closed for native dialogs and external application launches', async () => {
    installAutomationDesktopUiBlockers()

    await expect(openExternal('https://example.com')).rejects.toBeInstanceOf(
      AutomationDesktopUiError,
    )
    await expect(openPath('/tmp/openwaggle')).rejects.toBeInstanceOf(AutomationDesktopUiError)
    expect(() => showItemInFolder('/tmp/openwaggle')).toThrow(AutomationDesktopUiError)
    await expect(trashItem('/tmp/openwaggle')).rejects.toBeInstanceOf(AutomationDesktopUiError)
    await expect(showMessageBox(null, { message: 'Continue?' })).rejects.toBeInstanceOf(
      AutomationDesktopUiError,
    )
  })

  it('forces every Electron window hidden and blocks direct reveal methods', () => {
    installAutomationDesktopUiBlockers()

    const window = createBrowserWindow({ show: true })
    const baseWindow = createBaseWindow({ show: true })

    expect(window.isVisible()).toBe(false)
    expect(() => window.show()).toThrow(AutomationDesktopUiError)
    expect(() => window.focus()).toThrow(AutomationDesktopUiError)
    expect(baseWindow.isVisible()).toBe(false)
    expect(() => baseWindow.show()).toThrow(AutomationDesktopUiError)
    expect(() => baseWindow.focus()).toThrow(AutomationDesktopUiError)
  })

  it('allows a test to install one explicit deterministic dialog response', async () => {
    installAutomationDesktopUiBlockers()
    electronMocks.dialog.showMessageBox = vi
      .fn()
      .mockResolvedValue({ checkboxChecked: false, response: 1 })

    await expect(showMessageBox(null, { message: 'Continue?' })).resolves.toMatchObject({
      response: 1,
    })
  })
})
