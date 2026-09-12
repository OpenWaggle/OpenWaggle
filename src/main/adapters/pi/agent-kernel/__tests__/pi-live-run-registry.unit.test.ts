import { createHash } from 'node:crypto'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiModel } from '../../pi-provider-catalog'
import { piTextAndImageContentToParts } from '../message-parts'
import { registerPiLiveRun, steerPiLiveRun } from '../pi-live-run-registry'

describe('Pi live Run registry', () => {
  let unregister: (() => void) | undefined

  afterEach(() => unregister?.())

  it('delivers steering to the exact registered Pi Run', async () => {
    const steer = vi.fn(async (text: string) => text)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      sessionManager: { getEntries: () => [] },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-active', session, model })

    const result = await steerPiLiveRun({
      runId: 'run-active',
      text: 'Use the corrected migration order.',
      attachments: [],
    })

    expect(result).toEqual({
      accepted: true,
      receipt: {
        delivery: 'queued',
        minimumCreatedOrder: 0,
        durableTextSha256: createHash('sha256')
          .update('Use the corrected migration order.')
          .digest('hex'),
      },
    })
    expect(steer).toHaveBeenCalledWith('Use the corrected migration order.', undefined)
  })

  it('wraps untrusted visualization state into the exact steering message', async () => {
    const steer = vi.fn(
      async (text: string, _images?: unknown[], transformExpandedText?: (text: string) => string) =>
        transformExpandedText?.(text) ?? text,
    )
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      sessionManager: { getEntries: () => [] },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-visualization', session, model })

    const result = await steerPiLiveRun({
      runId: 'run-visualization',
      text: 'Explain this selection.',
      attachments: [],
      visualizationContext: {
        title: 'Service map',
        sourcePath: '/repo/service-map.html',
        state: { selectedService: 'api' },
      },
    })

    const steeringText = await steer.mock.results[0]?.value
    expect(steeringText).toContain('[OpenWaggle inline visualization context]')
    expect(steeringText).toContain('untrusted data')
    expect(steeringText).toContain('"selectedService":"api"')
    expect(steeringText).toContain('Explain this selection.')
    expect(result).toEqual({
      accepted: true,
      receipt: {
        delivery: 'queued',
        durableTextSha256: createHash('sha256').update('Explain this selection.').digest('hex'),
        minimumCreatedOrder: 0,
      },
    })
  })

  it('returns handled when an input hook consumes steering without a future user node', async () => {
    const prompt = vi.fn(async () => undefined)
    const steer = vi.fn(async (text: string) => text)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      prompt,
      steer,
      sessionManager: { getEntries: () => [] },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({
      runId: 'run-handled',
      session,
      model,
      routeThroughInputHook: true,
    })

    await expect(
      steerPiLiveRun({ runId: 'run-handled', text: '/handled', attachments: [] }),
    ).resolves.toEqual({
      accepted: true,
      receipt: { delivery: 'handled' },
    })
    expect(prompt).toHaveBeenCalledWith('/handled', { streamingBehavior: 'steer' })
    expect(steer).not.toHaveBeenCalled()
  })

  it('hashes Pi-transformed attachment input rather than the submitted preview text', async () => {
    const prompt = vi.fn(async (text: string) => `Expanded skill: résumé 🐝\n${text}`)
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      prompt,
      sessionManager: { getEntries: () => [] },
    })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({
      runId: 'run-attachment',
      session,
      model,
      routeThroughInputHook: true,
    })
    const text = '/review'
    const extractedText = 'attachment context '.repeat(100_000)
    const durableText = `Expanded skill: résumé 🐝\n/review\n\n[Attachment: context.txt]\n${extractedText.trim()}`

    const result = await steerPiLiveRun({
      runId: 'run-attachment',
      text,
      attachments: [
        {
          id: 'attachment-text',
          kind: 'text',
          name: 'context.txt',
          path: '/tmp/context.txt',
          mimeType: 'text/plain',
          sizeBytes: extractedText.length,
          extractedText,
          source: null,
        },
      ],
    })

    expect(result).toEqual({
      accepted: true,
      receipt: {
        delivery: 'queued',
        durableTextSha256: createHash('sha256').update(durableText, 'utf8').digest('hex'),
        minimumCreatedOrder: 0,
      },
    })
    expect(JSON.stringify(result).length).toBeLessThan(200)
    expect(JSON.stringify(result)).not.toContain(extractedText)
    expect(JSON.stringify(result)).not.toContain(createHash('sha256').update(text).digest('hex'))
  })

  it('correlates the first durable text block without projected image placeholders', async () => {
    const steer = vi.fn(async (text: string) => text)
    const model = fromPartial<PiModel>({ input: ['text', 'image'] })
    const session = fromPartial<AgentSession>({
      isStreaming: true,
      steer,
      model,
      sessionManager: { getEntries: () => [] },
    })
    unregister = registerPiLiveRun({ runId: 'run-image', session, model })
    const result = await steerPiLiveRun({
      runId: 'run-image',
      text: 'Read this image.',
      attachments: [
        {
          id: 'image',
          kind: 'image',
          name: 'image.png',
          path: '/tmp/image.png',
          mimeType: 'image/png',
          sizeBytes: 3,
          extractedText: '',
          source: { type: 'data', value: 'YWJj', mimeType: 'image/png' },
        },
      ],
    })
    const durableText = 'Read this image.\n\n[Attachment: image.png]'
    const image = { type: 'image', data: 'YWJj', mimeType: 'image/png' }
    const projected = piTextAndImageContentToParts([{ type: 'text', text: durableText }, image])

    expect(steer).toHaveBeenCalledWith(durableText, [image])
    expect(projected).toEqual([
      { type: 'text', text: durableText },
      { type: 'text', text: '[Image input: image/png]' },
    ])
    expect(result).toEqual({
      accepted: true,
      receipt: {
        delivery: 'queued',
        durableTextSha256: createHash('sha256').update(durableText).digest('hex'),
        minimumCreatedOrder: 0,
      },
    })
  })

  it('cancels steering waiting behind compaction when its exact Run unregisters', async () => {
    const steer = vi.fn(async (text: string) => text)
    const session = fromPartial<AgentSession>({ isStreaming: true, isCompacting: true, steer })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-compacting', session, model })

    const pending = steerPiLiveRun({
      runId: 'run-compacting',
      text: 'Continue safely.',
      attachments: [],
    })
    await Promise.resolve()
    unregister()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(steer).not.toHaveBeenCalled()
  })
})
