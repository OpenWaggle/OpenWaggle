import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { DesktopDialogsShape } from '../../dialogs'
import type { DesktopWindow } from '../../desktop-windows'
import { AUTOMATION_BLOCKED } from './automation'

export interface DesktopDialogsContractHarness {
  readonly subject: DesktopDialogsShape
  readonly openWindow: () => DesktopWindow
  /** The user's next answer: the button index, and the paths a file dialog returns. */
  readonly answerNext: (answer: {
    readonly button: number
    readonly paths: readonly string[]
  }) => void
  /** The window each dialog so far was modal to (`null` for an app-level dialog). */
  readonly dialogOwnerIds: () => readonly (number | null)[]
  readonly enterAutomation: () => void
}

export const desktopDialogsContract = definePortContract<DesktopDialogsContractHarness>(
  'DesktopDialogs',
  {
    'returns the button the user chose, modal to its owner window': async ({
      subject,
      openWindow,
      answerNext,
      dialogOwnerIds,
    }) => {
      const window = openWindow()
      answerNext({ button: 1, paths: [] })
      await expect(
        subject.showMessageBox(window, { message: 'Discard?', buttons: ['Keep', 'Discard'] }),
      ).resolves.toMatchObject({ response: 1 })
      await subject.showMessageBox(null, { message: 'App-level' })
      expect(dialogOwnerIds()).toEqual([window.id, null])
    },

    'returns chosen paths, and reports a cancelled file dialog': async ({
      subject,
      answerNext,
    }) => {
      answerNext({ button: 0, paths: ['/projects/app'] })
      await expect(
        subject.showOpenDialog(null, { properties: ['openDirectory'] }),
      ).resolves.toEqual({ canceled: false, filePaths: ['/projects/app'] })
      answerNext({ button: 0, paths: ['/tmp/export.json'] })
      await expect(subject.showSaveDialog(null, { defaultPath: 'export.json' })).resolves.toEqual({
        canceled: false,
        filePath: '/tmp/export.json',
      })
      answerNext({ button: 0, paths: [] })
      await expect(subject.showOpenDialog(null, {})).resolves.toMatchObject({ canceled: true })
      await expect(subject.showSaveDialog(null, {})).resolves.toMatchObject({ canceled: true })
    },

    'opens no dialog under automation': async ({ subject, dialogOwnerIds, enterAutomation }) => {
      enterAutomation()
      await expect(subject.showMessageBox(null, { message: 'Continue?' })).rejects.toMatchObject(
        AUTOMATION_BLOCKED,
      )
      await expect(subject.showOpenDialog(null, {})).rejects.toMatchObject(AUTOMATION_BLOCKED)
      await expect(subject.showSaveDialog(null, {})).rejects.toMatchObject(AUTOMATION_BLOCKED)
      expect(() => subject.showErrorBox('Failed', 'detail')).toThrow(
        expect.objectContaining(AUTOMATION_BLOCKED),
      )
      expect(dialogOwnerIds()).toEqual([])
    },
  },
)
