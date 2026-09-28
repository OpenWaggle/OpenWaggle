import { describe, expect, it } from 'vitest'
import { ipcErrorMessage } from '../ipc-error-message'

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

  it('keeps ordinary error messages and non-Error values readable', () => {
    expect(ipcErrorMessage(new Error('Select a model first.'))).toBe('Select a model first.')
    expect(ipcErrorMessage('plain failure')).toBe('plain failure')
  })
})
