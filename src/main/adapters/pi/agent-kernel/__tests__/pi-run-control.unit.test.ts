import { describe, expect, it, vi } from 'vitest'
import { createPiRunControl } from '../pi-run-control'
import { modelFromReference, payload } from './run-orchestration.test-utils'

describe('Pi native run control', () => {
  it('delivers steering through the live Pi session', async () => {
    const abortController = new AbortController()
    const session = {
      isCompacting: false,
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      sendCustomMessage: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => undefined),
    }
    const control = createPiRunControl(session, abortController.signal)

    await control.steer(payload('Take the safer path'))

    expect(session.sendUserMessage).toHaveBeenCalledWith('Take the safer path', {
      deliverAs: 'steer',
      expandPromptTemplates: true,
    })
  })

  it('expands queued slash commands before delivering steering', async () => {
    const session = {
      isCompacting: false,
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      sendUserMessage: vi.fn(async () => undefined),
    }
    const control = createPiRunControl(session, new AbortController().signal)

    await control.steer(payload('/skill:review-pr'))

    expect(session.sendUserMessage).toHaveBeenCalledWith('/skill:review-pr', {
      deliverAs: 'steer',
      expandPromptTemplates: true,
    })
  })

  it('waits for compaction and fails closed if the run is cancelled', async () => {
    let isCompacting = true
    const abortController = new AbortController()
    const session = {
      get isCompacting() {
        return isCompacting
      },
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      sendCustomMessage: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => undefined),
    }
    const control = createPiRunControl(session, abortController.signal)
    const pending = control.steer(payload('Wait for the checkpoint'))

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(session.sendUserMessage).not.toHaveBeenCalled()
    abortController.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    isCompacting = false
  })

  it('delivers exactly once after compaction finishes', async () => {
    let isCompacting = true
    const session = {
      get isCompacting() {
        return isCompacting
      },
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      sendCustomMessage: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => undefined),
    }
    const control = createPiRunControl(session, new AbortController().signal)
    const pending = control.steer(payload('Continue after the checkpoint'))

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(session.sendUserMessage).not.toHaveBeenCalled()
    isCompacting = false
    await pending

    expect(session.sendUserMessage).toHaveBeenCalledOnce()
    expect(session.sendUserMessage).toHaveBeenCalledWith('Continue after the checkpoint', {
      deliverAs: 'steer',
      expandPromptTemplates: true,
    })
  })

  it('queues visualization context and the user request as one steering message', async () => {
    const abortController = new AbortController()
    const session = {
      isCompacting: false,
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      sendCustomMessage: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => undefined),
    }
    const control = createPiRunControl(session, abortController.signal)

    await control.steer(
      payload('Explain the selected service', {
        visualizationContext: {
          title: 'Service map',
          sourcePath: '/repo/service-map.html',
          state: { selectedService: 'api' },
        },
      }),
    )

    expect(session.sendCustomMessage).not.toHaveBeenCalled()
    expect(session.sendUserMessage).toHaveBeenCalledOnce()
    expect(session.sendUserMessage).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[OpenWaggle inline visualization context\][\s\S]*"selectedService":"api"[\s\S]*Explain the selected service/,
      ),
      { deliverAs: 'steer', expandPromptTemplates: true },
    )
  })

  it('uses the live session model capabilities for steered attachments', async () => {
    const imageModel = modelFromReference('openai/gpt-5.5')
    const textModel = { ...imageModel, input: imageModel.input.filter((input) => input === 'text') }
    let supportsImages = false
    const session = {
      isCompacting: false,
      isStreaming: true,
      get model() {
        return supportsImages ? imageModel : textModel
      },
      sendCustomMessage: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => undefined),
    }
    const control = createPiRunControl(session, new AbortController().signal)
    supportsImages = true

    await control.steer(
      payload('Inspect this', {
        attachments: [
          {
            id: 'image-1',
            kind: 'image',
            name: 'diagram.png',
            path: '/tmp/diagram.png',
            mimeType: 'image/png',
            sizeBytes: 4,
            extractedText: 'Diagram',
            source: { type: 'data', value: 'base64-image', mimeType: 'image/png' },
          },
        ],
      }),
    )

    expect(session.sendUserMessage).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'image', data: 'base64-image' })]),
      { deliverAs: 'steer', expandPromptTemplates: true },
    )
  })
})
