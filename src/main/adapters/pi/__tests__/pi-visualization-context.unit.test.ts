import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import { describe, expect, it } from 'vitest'
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
    const marker = '[OpenWaggle inline visualization context]'
    const oldTurn: PiContextMessage = {
      role: 'custom',
      customType: PI_WAGGLE_TURN_CUSTOM_TYPE,
      content: `First turn\n\n${marker}\nold selection\n[/OpenWaggle inline visualization context]`,
      display: false,
      timestamp: 1,
    }
    const activeTurn: PiContextMessage = {
      ...oldTurn,
      content: `Second turn\n\n${marker}\ncurrent selection\n[/OpenWaggle inline visualization context]`,
      timestamp: 2,
    }

    const filtered = await filterConsumedVisualizationContext([oldTurn, activeTurn])

    expect(JSON.stringify(filtered[0])).not.toContain('old selection')
    expect(JSON.stringify(filtered[1])).toContain('current selection')
  })
})
