import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createSessionsToolExtension } from '../sessions-tool-extension'

describe('Sessions tool Hive cleanup guidance', () => {
  it('tells the Queen that finished untouched Workers are archived and come back with new work', async () => {
    const registerTool = vi.fn()
    await createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const guidelines: unknown = registerTool.mock.calls[0]?.[0]?.promptGuidelines
    expect(guidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/accept or cancel a Worker.*archives it on your behalf/),
      ]),
    )
    expect(guidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /start, follow_up, steer, or replace to a Worker that cleanup archived, or reopening or requesting revision of its Delegation, restores it/,
        ),
      ]),
    )
    expect(guidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/archived explicitly stays archived; use unarchive to show it again/),
      ]),
    )
  })
})
