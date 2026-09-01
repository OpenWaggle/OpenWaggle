import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createExtensionFrameSyntaxRequests } from '../extension-frame-syntax-requests'

const syntaxMock = vi.hoisted(() => ({
  highlightExtensionSyntax: vi.fn(),
}))

vi.mock('../extension-syntax-sdk', () => syntaxMock)

describe('extension frame syntax request backpressure', () => {
  beforeEach(() => {
    syntaxMock.highlightExtensionSyntax.mockReset()
    syntaxMock.highlightExtensionSyntax.mockImplementation(() => new Promise(() => undefined))
  })

  it('rejects excess distinct requests without retaining their source', () => {
    const requests = createExtensionFrameSyntaxRequests()
    for (
      let index = 0;
      index < WORKSPACE_EDITOR_PERFORMANCE.EXTENSION_FRAME_SYNTAX_MAX_REQUESTS;
      index += 1
    ) {
      requests.highlight(
        `request-${String(index)}`,
        { source: `const value${String(index)} = ${String(index)}`, language: 'typescript' },
        () => true,
        vi.fn(),
      )
    }

    const postResult = vi.fn()
    requests.highlight(
      'overflow',
      { source: 'const overflow = true', language: 'typescript' },
      () => true,
      postResult,
    )

    expect(syntaxMock.highlightExtensionSyntax).toHaveBeenCalledTimes(
      WORKSPACE_EDITOR_PERFORMANCE.EXTENSION_FRAME_SYNTAX_MAX_REQUESTS,
    )
    expect(postResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'plain-text',
        diagnostic: expect.stringContaining('Too many syntax requests'),
      }),
    )
    requests.dispose()
  })
})
