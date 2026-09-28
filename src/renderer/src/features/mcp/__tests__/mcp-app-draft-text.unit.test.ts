import { describe, expect, it } from 'vitest'
import { mcpAppDraftJson, mcpAppDraftText } from '../mcp-app-draft-text'

const PNG = 'iVBORw0KGgoAAAANSUhEUg=='

describe('MCP App draft text', () => {
  it('removes data URIs from App text blocks but keeps the surrounding prose', () => {
    const text = mcpAppDraftText([
      { type: 'text', text: `Preview data:image/png;base64,${PNG} rendered inline.` },
    ])

    expect(text).not.toContain(PNG)
    expect(text).toContain('Preview [image/png data URI omitted:')
    expect(text).toContain('] rendered inline.')
  })

  it('removes image payloads from JSON fallbacks and staged context', () => {
    const fallback = mcpAppDraftText([{ type: 'image', data: PNG, mimeType: 'image/png' }])
    const staged = mcpAppDraftJson({
      screenshot: { type: 'image', data: PNG, mimeType: 'image/png' },
    })

    expect(fallback).not.toContain(PNG)
    expect(staged).not.toContain(PNG)
    expect(staged).toContain('[image data omitted:')
  })
})
