import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))

import { ipcRenderer } from 'electron'
import { api } from '../api'

describe('preload error envelopes', () => {
  it('sends renderer error envelopes to the main process over their own channel', () => {
    const envelope = '{}\n{"type":"event"}\n{}'

    api.sendErrorReportEnvelope(envelope)

    expect(ipcRenderer.send).toHaveBeenCalledWith('error-reporting:renderer-envelope', envelope)
  })
})
