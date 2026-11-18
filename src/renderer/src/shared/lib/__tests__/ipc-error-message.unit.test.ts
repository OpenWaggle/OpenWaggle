import { describe, expect, it } from 'vitest'
import { ipcErrorMessage, ipcFailureMessage } from '../ipc-error-message'

describe('ipcErrorMessage', () => {
  it('removes the Electron invoke prefix from a rejected IPC call', () => {
    expect(
      ipcErrorMessage(
        new Error(
          "Error invoking remote method 'agent:compact-session': Error: Nothing to compact (session too small)",
        ),
      ),
    ).toBe('Nothing to compact (session too small)')
  })

  it('removes the class name of a named main-process error', () => {
    expect(
      ipcErrorMessage(
        new Error(
          "Error invoking remote method 'agent:compact-session': GuiSessionHostRetiredForUpgradeError: Restart OpenWaggle.",
        ),
      ),
    ).toBe('Restart OpenWaggle.')
  })

  it('keeps ordinary error messages and non-Error values readable', () => {
    expect(ipcErrorMessage(new Error('Select a model first.'))).toBe('Select a model first.')
    expect(ipcErrorMessage('plain failure')).toBe('plain failure')
  })
})

describe('ipcFailureMessage', () => {
  it("shows the main process's reason for a failed shell action, never the transport text", () => {
    expect(
      ipcFailureMessage(
        new Error("Error invoking remote method 'shell:open-path': Error: Failed to open path"),
        'Could not open this resource.',
      ),
    ).toBe('Failed to open path')
  })

  it('falls back when the failure carries no message', () => {
    expect(ipcFailureMessage(undefined, 'Could not open this resource.')).toBe(
      'Could not open this resource.',
    )
    expect(
      ipcFailureMessage(
        new Error("Error invoking remote method 'shell:open-path': Error: "),
        'Could not open this resource.',
      ),
    ).toBe('Could not open this resource.')
  })
})
