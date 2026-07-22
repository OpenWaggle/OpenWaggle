import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { createSessionListener } from '../session-listener'

describe('createSessionListener Pi compatibility', () => {
  it('does not duplicate Pi settlement or extension-entry persistence as transport events', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      {
        model: SupportedModelId('openai/gpt-5.4'),
        onEvent: (event) => emitted.push(event),
      },
      'run-1',
    )

    listener({ type: 'agent_settled' })
    listener({
      type: 'entry_appended',
      entry: {
        type: 'custom',
        id: 'entry-1',
        parentId: null,
        timestamp: '2026-07-13T00:00:00.000Z',
        customType: 'openwaggle.test',
        data: { persisted: true },
      },
    })

    expect(emitted).toEqual([])
  })
})
