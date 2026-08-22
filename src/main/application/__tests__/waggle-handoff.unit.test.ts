import { BUILT_IN_WAGGLE_PRESETS } from '@openwaggle/waggle-core'
import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { toJsonValue } from '../../adapters/pi/pi-message-mapper'
import { findWaggleHandoffRequest } from '../waggle-handoff'

function toolResultMessage(details: unknown, isError = false): Message {
  return {
    id: MessageId('tool-result-message'),
    role: 'assistant',
    parts: [
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId('waggle-call'),
          name: 'waggle_invoke',
          args: {},
          result: null,
          isError,
          duration: 1,
          details: toJsonValue(details),
        },
      },
    ],
    createdAt: 1,
  }
}

describe('findWaggleHandoffRequest', () => {
  it('decodes the latest successful native Waggle tool handoff', () => {
    const preset = BUILT_IN_WAGGLE_PRESETS[0]
    if (!preset) throw new Error('Expected a built-in Waggle preset')

    const result = findWaggleHandoffRequest([
      toolResultMessage({
        kind: 'waggle-handoff',
        presetId: preset.id,
        presetName: preset.name,
        source: 'agent',
        config: preset.config,
        prompt: 'Review the implementation.',
      }),
    ])

    expect(result).toMatchObject({
      kind: 'waggle-handoff',
      presetId: preset.id,
      source: 'agent',
      prompt: 'Review the implementation.',
    })
  })

  it('ignores failed or malformed tool results', () => {
    expect(findWaggleHandoffRequest([toolResultMessage({ kind: 'nope' })])).toBeNull()
    expect(
      findWaggleHandoffRequest([
        toolResultMessage(
          {
            kind: 'waggle-handoff',
            presetId: 'code-review',
          },
          true,
        ),
      ]),
    ).toBeNull()
  })
})
