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

function assistant(
  text: string,
  timestamp: number,
  stopReason: 'stop' | 'toolUse' | 'length' = 'stop',
): PiContextMessage {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-5.5',
    content: [{ type: 'text', text }],
    stopReason,
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

  it('strips atomic context after its turn completes without a newer prompt', async () => {
    const context = [
      '[OpenWaggle inline visualization context]',
      'completed selection',
      '[/OpenWaggle inline visualization context]',
    ].join('\n')
    const atomicPrompt = user(buildAtomicVisualizationPrompt(context, 'inspect the selection'), 1)

    const filtered = await filterConsumedVisualizationContext([
      atomicPrompt,
      assistant('completed answer', 2),
    ])

    expect(filtered[0]).toEqual(user('inspect the selection', 1))
    expect(JSON.stringify(filtered)).not.toContain('completed selection')
  })

  it('keeps atomic context while a tool-use turn still needs another model call', async () => {
    const context = [
      '[OpenWaggle inline visualization context]',
      'active selection',
      '[/OpenWaggle inline visualization context]',
    ].join('\n')
    const atomicPrompt = user(buildAtomicVisualizationPrompt(context, 'inspect the selection'), 1)

    const filtered = await filterConsumedVisualizationContext([
      atomicPrompt,
      assistant('calling a tool', 2, 'toolUse'),
    ])

    expect(filtered[0]).toEqual(atomicPrompt)
    expect(JSON.stringify(filtered)).toContain('active selection')
  })

  it('keeps atomic context when overflow compaction will retry the same prompt', async () => {
    const context = [
      '[OpenWaggle inline visualization context]',
      'retry selection',
      '[/OpenWaggle inline visualization context]',
    ].join('\n')
    const atomicPrompt = user(buildAtomicVisualizationPrompt(context, 'retry this prompt'), 1)

    const filtered = await filterConsumedVisualizationContext(
      [atomicPrompt, assistant('truncated', 2, 'length')],
      undefined,
      { willRetry: true },
    )

    expect(filtered[0]).toEqual(atomicPrompt)
    expect(JSON.stringify(filtered)).toContain('retry selection')
  })

  it('does not correlate different same-millisecond prompts', async () => {
    const context = [
      '[OpenWaggle inline visualization context]',
      'older colliding selection',
      '[/OpenWaggle inline visualization context]',
    ].join('\n')
    const olderPrompt = user(buildAtomicVisualizationPrompt(context, 'older prompt'), 1)
    const activePrompt = user('different active prompt', 1)

    const filtered = await filterConsumedVisualizationContext(
      [olderPrompt],
      [olderPrompt, assistant('older answer', 2), activePrompt, assistant('tool', 3, 'toolUse')],
    )

    expect(filtered[0]).toEqual(user('older prompt', 1))
    expect(JSON.stringify(filtered)).not.toContain('older colliding selection')
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
