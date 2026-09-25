import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { expandedTurnKeysWithAliases, persistedUserMessageAliases } from '../turn-fold-aliases'

const user = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', content: text }],
})
const assistant = (id: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', content: 'reply' }],
})

describe('turn fold aliases', () => {
  it('pairs a persisted user message with the optimistic copy shown before it', () => {
    const live = [user('u1', 'first'), assistant('a1'), user('optimistic-2', 'second')]
    const transcript = [user('u1', 'first'), assistant('a1'), user('node-2', 'second')]

    expect([...persistedUserMessageAliases(live, transcript)]).toEqual([['node-2', 'optimistic-2']])
  })

  it('prefers the persisted node recorded on the live copy over its text', () => {
    const live: UIMessage[] = [
      { ...user('optimistic-2', 'as typed'), metadata: { sessionNodeId: 'node-2' } },
    ]
    const transcript = [user('node-2', 'as typed, with context the runtime appended')]

    expect([...persistedUserMessageAliases(live, transcript)]).toEqual([['node-2', 'optimistic-2']])
  })

  it('pairs repeated texts in order', () => {
    const live = [user('o1', 'again'), user('o2', 'again')]
    const transcript = [user('n1', 'again'), user('n2', 'again')]

    expect([...persistedUserMessageAliases(live, transcript)]).toEqual([
      ['n1', 'o1'],
      ['n2', 'o2'],
    ])
  })

  it('keeps a turn expanded across the id swap', () => {
    const aliases = new Map([['node-2', 'optimistic-2']])
    const expanded = expandedTurnKeysWithAliases(new Set(['optimistic-2']), aliases)

    expect(expanded.has('node-2')).toBe(true)
  })

  it('returns the same set when nothing is aliased', () => {
    const expanded = new Set(['u1'])
    expect(expandedTurnKeysWithAliases(expanded, new Map())).toBe(expanded)
    expect(expandedTurnKeysWithAliases(expanded, new Map([['n', 'o']]))).toBe(expanded)
  })
})
