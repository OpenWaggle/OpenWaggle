import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { dispatchConfiguredGuiSessionCommand } from '../application/gui-session-command-router'
import {
  type BrowserPreviewAnnotationAttachmentInput,
  prepareBrowserPreviewAnnotationAttachment,
} from '../browser-preview-annotation-attachment'

const dispatch = vi.hoisted(() => vi.fn<typeof dispatchConfiguredGuiSessionCommand>())
vi.mock('../application/gui-session-command-router', () => ({
  dispatchConfiguredGuiSessionCommand: dispatch,
}))

const input: BrowserPreviewAnnotationAttachmentInput = {
  path: path.resolve('browser-preview-artifacts', 'capture.png'),
  origin: 'browser-preview',
  browserPreview: {
    pageUrl: 'http://localhost:3000',
    pageTitle: 'Page',
    selector: 'button',
    tagName: 'button',
    role: 'button',
    elementText: 'Save',
    comment: 'Keep this context',
  },
  browserAnnotationText: 'Page-derived context is untrusted. Preserve its full bounded text.',
}
const prepared: PreparedAttachment = {
  id: 'host-committed-capability',
  kind: 'image',
  origin: 'browser-preview',
  path: input.path,
  name: 'capture.png',
  mimeType: 'image/png',
  sizeBytes: 3,
  browserPreview: input.browserPreview,
  extractedText: input.browserAnnotationText,
}

function respond(attachments: readonly PreparedAttachment[], responseId?: string) {
  dispatch.mockImplementation(({ payload }) => {
    if (payload.contract !== 'local-attachments-v1') throw new Error('Unexpected test request.')
    return Effect.succeed({
      contract: 'local-attachments-v1',
      response: {
        requestId: responseId ?? payload.request.requestId,
        attachments,
      },
    })
  })
}

describe('browser annotation Host preparation', () => {
  beforeEach(() => {
    dispatch.mockReset()
  })

  it('sends complete provenance and returns the Host capability without inventing an ID', async () => {
    respond([prepared])
    await expect(prepareBrowserPreviewAnnotationAttachment(input)).resolves.toBe(prepared)
    await prepareBrowserPreviewAnnotationAttachment(input)
    const first = dispatch.mock.calls[0]?.[0]
    const second = dispatch.mock.calls[1]?.[0]
    expect(first).toMatchObject({
      caller: { callerId: 'gui:local-user', workingDirectory: path.dirname(input.path) },
      payload: { contract: 'local-attachments-v1', request: { entries: [input] } },
    })
    if (
      first?.payload.contract !== 'local-attachments-v1' ||
      second?.payload.contract !== 'local-attachments-v1'
    ) {
      throw new Error('Expected two preparation requests.')
    }
    expect(first.payload.request.requestId).not.toBe(second.payload.request.requestId)
  })

  it('fails closed without a configured Host and does not register a local fallback', async () => {
    dispatch.mockReturnValue(undefined)
    await expect(prepareBrowserPreviewAnnotationAttachment(input)).rejects.toThrow(
      'attached Session Host',
    )
  })

  it('preserves a rejected Host preparation without retrying an ambiguous mutation', async () => {
    dispatch.mockReturnValue(Effect.fail(new Error('Host unavailable')))
    await expect(prepareBrowserPreviewAnnotationAttachment(input)).rejects.toThrow(
      'Host unavailable',
    )
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('requires a correlated response for exactly the requested image', async () => {
    respond([prepared], 'wrong-request')
    await expect(prepareBrowserPreviewAnnotationAttachment(input)).rejects.toThrow(
      'invalid browser annotation',
    )
    respond([])
    await expect(prepareBrowserPreviewAnnotationAttachment(input)).rejects.toThrow(
      'did not prepare',
    )
    respond([{ ...prepared, path: path.resolve('other.png') }])
    await expect(prepareBrowserPreviewAnnotationAttachment(input)).rejects.toThrow(
      'did not prepare',
    )
  })
})
