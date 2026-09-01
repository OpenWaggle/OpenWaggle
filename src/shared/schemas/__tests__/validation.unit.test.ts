import { safeDecodeUnknown } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import { MAX_INLINE_VISUALIZATION_PATH_LENGTH } from '../../constants/inline-visualization'
import { parseInlineVisualizationReference } from '../../utils/inline-visualization'
import { agentSendPayloadSchema, toAgentSendPayload } from '../validation'

const BASE_PAYLOAD = {
  text: 'Explain the selection',
  thinkingLevel: 'off',
  attachments: [],
} as const

describe('agentSendPayloadSchema visualization context', () => {
  it('preserves a bounded JSON visualization context', () => {
    const decoded = safeDecodeUnknown(agentSendPayloadSchema, {
      ...BASE_PAYLOAD,
      visualizationContext: {
        title: 'Service map',
        sourcePath: '/repo/map.html',
        state: { selected: 'api' },
      },
    })

    expect(decoded.success).toBe(true)
    if (!decoded.success) return
    expect(toAgentSendPayload(decoded.data).visualizationContext).toEqual({
      title: 'Service map',
      sourcePath: '/repo/map.html',
      state: { selected: 'api' },
    })
  })

  it('rejects visualization state larger than the renderer-host contract', () => {
    const decoded = safeDecodeUnknown(agentSendPayloadSchema, {
      ...BASE_PAYLOAD,
      visualizationContext: {
        title: 'Service map',
        sourcePath: '/repo/map.html',
        state: { value: 'x'.repeat(20_000) },
      },
    })

    expect(decoded.success).toBe(false)
  })

  it('accepts a source path at the visualization reference boundary', () => {
    const sourcePath = `/${'a'.repeat(MAX_INLINE_VISUALIZATION_PATH_LENGTH - 1)}`
    const reference = parseInlineVisualizationReference(JSON.stringify({ path: sourcePath }))
    expect(reference?.path).toBe(sourcePath)
    const decoded = safeDecodeUnknown(agentSendPayloadSchema, {
      ...BASE_PAYLOAD,
      visualizationContext: {
        title: 'Boundary map',
        sourcePath: reference?.path,
        state: { selected: true },
      },
    })

    expect(decoded.success).toBe(true)
  })
})
