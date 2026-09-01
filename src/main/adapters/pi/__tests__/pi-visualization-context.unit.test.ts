import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import { describe, expect, it } from 'vitest'
import { buildAtomicVisualizationPrompt } from '../pi-runtime-input'
import {
  filterConsumedVisualizationContext,
  PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE,
  type PiContextMessage,
} from '../pi-visualization-context'

function user(text: string, timestamp: number): PiContextMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp }
}

function assistant(text: string, timestamp: number): PiContextMessage {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-5.5',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp,
  }
}

function visualizationContext(timestamp: number): PiContextMessage {
  return {
    role: 'custom',
    customType: PI_VISUALIZATION_CONTEXT_CUSTOM_TYPE,
    content: 'current visualization state',
    display: false,
    timestamp,
  }
}

describe('Pi visualization context filtering', () => {
  it('keeps atomic steering context for its turn and strips it from later turns', async () => {
    const context = [
      '[OpenWaggle inline visualization context]',
      'current selection',
      '[/OpenWaggle inline visualization context]',
    ].join('\n')
    const atomicPrompt = user(buildAtomicVisualizationPrompt(context, 'inspect the selection'), 1)

    await expect(filterConsumedVisualizationContext([atomicPrompt])).resolves.toEqual([
      atomicPrompt,
    ])

    const laterTurn = [atomicPrompt, assistant('answer', 2), user('unrelated follow-up', 3)]
    const filtered = await filterConsumedVisualizationContext(laterTurn)

    expect(filtered[0]).toEqual(user('inspect the selection', 1))
    expect(JSON.stringify(filtered)).not.toContain('current selection')
  })

  it('keeps the current aside but removes it after the next user prompt begins', async () => {
    const current = [user('first', 1), visualizationContext(2)]
    await expect(filterConsumedVisualizationContext(current)).resolves.toEqual(current)

    const consumed = [...current, assistant('answer', 3), user('unrelated follow-up', 4)]
    await expect(filterConsumedVisualizationContext(consumed)).resolves.toEqual([
      consumed[0],
      consumed[2],
      consumed[3],
    ])
  })

  it('strips visualization data from older Waggle turns while keeping the active turn', async () => {
    const oldTurn: PiContextMessage = {
      role: 'custom',
      customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
      content:
        'First turn keeps literal [OpenWaggle inline visualization context] user content intact',
      display: false,
      details: {
        openWaggleVisualizationContext:
          '[OpenWaggle inline visualization context]\nold selection including [OpenWaggle inline visualization context]\n[/OpenWaggle inline visualization context]',
      },
      timestamp: 1,
    }
    const activeTurn: PiContextMessage = {
      ...oldTurn,
      content: 'Second turn',
      details: {
        openWaggleVisualizationContext:
          '[OpenWaggle inline visualization context]\ncurrent selection\n[/OpenWaggle inline visualization context]',
      },
      timestamp: 2,
    }

    const filtered = await filterConsumedVisualizationContext([oldTurn, activeTurn])

    expect(JSON.stringify(filtered)).not.toContain('old selection')
    expect(filtered).toHaveLength(3)
    expect(JSON.stringify(filtered[0])).toContain('user content intact')
    expect(JSON.stringify(filtered[2])).toContain('current selection')
  })
})
