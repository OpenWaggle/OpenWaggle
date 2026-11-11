import { describe, expect, it, vi } from 'vitest'

vi.mock('../transport', async () =>
  (await import('./fake-preload-transport')).fakePreloadTransport(),
)

import { shellChannel as ipcRenderer } from './fake-preload-transport'
import { api } from '../api'

describe('preload error envelopes', () => {
  it('sends renderer error envelopes to the main process over their own channel', () => {
    const envelope = '{}\n{"type":"event"}\n{}'

    api.sendErrorReportEnvelope(envelope)

    expect(ipcRenderer.send).toHaveBeenCalledWith('error-reporting:renderer-envelope', envelope)
  })
})
