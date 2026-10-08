import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { resolveLatestAssistantNodeId } from '../agent-run-service'

function node(id: string, createdOrder: number, role: 'user' | 'assistant') {
  return fromPartial<ProjectedSessionNodeInput>({ id, createdOrder, role })
}

const snapshot = [node('u1', 0, 'user'), node('a1', 1, 'assistant'), node('a2', 2, 'assistant')]

describe('resolveLatestAssistantNodeId', () => {
  it('anchors to the latest assistant node of the snapshot', () => {
    expect(resolveLatestAssistantNodeId(snapshot)).toBe('a2')
    expect(
      resolveLatestAssistantNodeId(snapshot, [
        { id: 'a1', createdOrder: 1 },
        { id: 'a2', createdOrder: 2 },
      ]),
    ).toBe('a2')
  })

  it('follows a node renamed while saving through its created order', () => {
    expect(
      resolveLatestAssistantNodeId(snapshot, [
        { id: 'u1', createdOrder: 0, role: 'user' },
        { id: 'a1', createdOrder: 1, role: 'assistant' },
        { id: 'renamed-a2', createdOrder: 2, role: 'assistant' },
      ]),
    ).toBe('renamed-a2')
  })

  it('keeps the snapshot id when no saved assistant node took its place', () => {
    expect(resolveLatestAssistantNodeId(snapshot, [{ id: 'u1', createdOrder: 0 }])).toBe('a2')
  })
})
