import { describe, expect, it } from 'vitest'
import { rowKeyNodeId } from '../transcript-remote-history'

describe('rowKeyNodeId', () => {
  it('names the Session node a saved reading position anchors on', () => {
    expect(rowKeyNodeId('message:node-1')).toBe('node-1')
    expect(rowKeyNodeId('message:session-a/entry#2')).toBe('session-a/entry')
    expect(rowKeyNodeId('turn-fold:node-2')).toBe('node-2')
    expect(rowKeyNodeId('compaction:node-3')).toBe('node-3')
    expect(rowKeyNodeId('branch-summary:node-4')).toBe('node-4')
  })

  it('names no node for rows that are not a node', () => {
    expect(rowKeyNodeId('phase:Thinking')).toBeNull()
    expect(rowKeyNodeId('interaction:abc')).toBeNull()
    expect(rowKeyNodeId('message:')).toBeNull()
  })
})
