import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({ protocol: { handle: handleMock } }))

import {
  inlineVisualizationUrl,
  registerInlineVisualizationFrame,
  registerInlineVisualizationProtocolOnce,
} from '../inline-visualization-protocol'

describe('inline visualization protocol restored state', () => {
  it('embeds the restored state as escaped metadata ahead of the host runtime', async () => {
    const frameId = '22345678-1234-4123-8123-123456789abc'
    registerInlineVisualizationProtocolOnce({
      readSource: async () => ({ status: 'loaded', contents: '<p>Picker</p>', sizeBytes: 13 }),
    })
    const handler = handleMock.mock.calls[0]?.[1]
    if (typeof handler !== 'function') throw new Error('Expected the visualization handler.')
    registerInlineVisualizationFrame(
      {
        frameId,
        reducedMotion: false,
        sessionId: SessionId('session-restore'),
        sourcePath: '/visualizations/picker.html',
        restoredState: { selected: 'B', note: '"><script>alert(1)</script>' },
      },
      3,
    )

    const document = await (await handler({ url: inlineVisualizationUrl(frameId) })).text()

    const metadata =
      '<meta name="openwaggle-visualization-state" content="{&quot;selected&quot;:&quot;B&quot;,' +
      '&quot;note&quot;:&quot;\\&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;}">'
    expect(document).toContain(metadata)
    expect(document.indexOf(metadata)).toBeLessThan(document.indexOf('<script>'))
    expect(document).not.toContain('<script>alert(1)</script>')
  })

  it('rejects an oversized restored state', () => {
    const base = {
      reducedMotion: false,
      sessionId: SessionId('session-restore'),
      sourcePath: '/visualizations/picker.html',
    }
    expect(() =>
      registerInlineVisualizationFrame(
        {
          ...base,
          frameId: '32345678-1234-4123-8123-123456789abc',
          restoredState: { value: 'x'.repeat(17 * 1024) },
        },
        3,
      ),
    ).toThrow('restored state')
  })
})
