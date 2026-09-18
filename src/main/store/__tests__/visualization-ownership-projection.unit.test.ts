import { SessionId } from '@shared/types/brand'
import {
  VISUALIZE_REFERENCE_END,
  VISUALIZE_REFERENCE_START,
} from '@shared/utils/inline-visualization'
import { describe, expect, it } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { preserveVisualizationOwnership } from '../session-details/visualization-ownership-projection'

function assistantNode(
  id: string,
  contentJson: string,
  metadataJson: string,
): ProjectedSessionNodeInput {
  return {
    id,
    parentId: null,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: 1,
    contentJson,
    metadataJson,
    pathDepth: 0,
    createdOrder: 0,
  }
}

describe('preserveVisualizationOwnership', () => {
  it('restores owner metadata for delimiter-free own-line references after re-projection', () => {
    const sourcePath = '/app-data/visualizations/original-session/map.html'
    const contentJson = JSON.stringify({
      parts: [{ type: 'text', text: `visualize{"path":"${sourcePath}"}` }],
    })
    const ownerSessionId = SessionId('original-session')

    const nodes = preserveVisualizationOwnership(
      [assistantNode('assistant-map', contentJson, '{}')],
      new Map([['assistant-map', JSON.stringify({ visualizationSessionId: ownerSessionId })]]),
    )

    expect(JSON.parse(nodes[0]?.metadataJson ?? '{}')).toEqual({
      visualizationSessionId: ownerSessionId,
    })
  })

  it('restores owner metadata for the delimited reference form', () => {
    const contentJson = JSON.stringify({
      parts: [
        {
          type: 'text',
          text: `${VISUALIZE_REFERENCE_START}{"path":"/app-data/visualizations/map.html"}${VISUALIZE_REFERENCE_END}`,
        },
      ],
    })
    const ownerSessionId = SessionId('original-session')

    const nodes = preserveVisualizationOwnership(
      [assistantNode('assistant-map', contentJson, '{}')],
      new Map([['assistant-map', JSON.stringify({ visualizationSessionId: ownerSessionId })]]),
    )

    expect(JSON.parse(nodes[0]?.metadataJson ?? '{}')).toEqual({
      visualizationSessionId: ownerSessionId,
    })
  })

  it('keeps existing metadata and ignores nodes without references', () => {
    const reference = JSON.stringify({
      parts: [{ type: 'text', text: 'visualize{"path":"/app-data/visualizations/map.html"}' }],
    })
    const existing = JSON.stringify({ provider: 'openai' })

    const nodes = preserveVisualizationOwnership(
      [
        assistantNode('with-owner', reference, existing),
        assistantNode(
          'assistant-no-reference',
          JSON.stringify({ parts: [{ type: 'text', text: 'Plain answer.' }] }),
          '{}',
        ),
        assistantNode('assistant-no-owner-record', reference, '{}'),
      ],
      new Map([['with-owner', JSON.stringify({ visualizationSessionId: 'other-session' })]]),
    )

    expect(JSON.parse(nodes[0]?.metadataJson ?? '{}')).toEqual({
      provider: 'openai',
      visualizationSessionId: 'other-session',
    })
    expect(nodes[1]?.metadataJson).toBe('{}')
    expect(nodes[2]?.metadataJson).toBe('{}')
  })
})
