import { describe, expect, it, vi } from 'vitest'
import { createPiRunControl } from '../pi-run-control'
import { modelFromReference, payload } from './run-orchestration.test-utils'

function nativeSteering() {
  const messages: string[] = []
  return {
    getSteeringMessages: () => messages,
    steer: vi.fn(async (text: string) => {
      messages.push(text)
    }),
  }
}

describe('Pi native run control', () => {
  it('delivers steering through the live Pi session', async () => {
    const abortController = new AbortController()
    const session = {
      isCompacting: false,
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      ...nativeSteering(),
    }
    const control = createPiRunControl(session, abortController.signal)

    await control.steer(payload('Take the safer path'))

    expect(session.steer).toHaveBeenCalledWith('Take the safer path', undefined)
  })

  it('expands queued slash commands before delivering steering', async () => {
    const steeringMessages: string[] = []
    const session = {
      isCompacting: false,
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      getSteeringMessages: () => steeringMessages,
      steer: vi.fn(async () => {
        steeringMessages.push('Expanded review skill')
      }),
    }
    const control = createPiRunControl(session, new AbortController().signal)

    const result = await control.steer(payload('/skill:review-pr'))

    expect(session.steer).toHaveBeenCalledWith('/skill:review-pr', undefined)
    expect(result).toEqual({ delivery: 'queued', durableText: 'Expanded review skill' })
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
      ...nativeSteering(),
    }
    const control = createPiRunControl(session, abortController.signal)
    const pending = control.steer(payload('Wait for the checkpoint'))

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(session.steer).not.toHaveBeenCalled()
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
      ...nativeSteering(),
    }
    const control = createPiRunControl(session, new AbortController().signal)
    const pending = control.steer(payload('Continue after the checkpoint'))

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(session.steer).not.toHaveBeenCalled()
    isCompacting = false
    await pending

    expect(session.steer).toHaveBeenCalledOnce()
    expect(session.steer).toHaveBeenCalledWith('Continue after the checkpoint', undefined)
  })

  it('queues visualization context and the user request as one steering message', async () => {
    const abortController = new AbortController()
    const session = {
      isCompacting: false,
      isStreaming: true,
      model: modelFromReference('openai/gpt-5.5'),
      ...nativeSteering(),
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

    expect(session.steer).toHaveBeenCalledOnce()
    expect(session.steer).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[OpenWaggle inline visualization context\][\s\S]*"selectedService":"api"[\s\S]*Explain the selected service/,
      ),
      undefined,
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
      ...nativeSteering(),
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

    expect(session.steer).toHaveBeenCalledWith(
      expect.stringMatching(/Inspect this[\s\S]*\[Attachment: diagram\.png\][\s\S]*Diagram/),
      expect.arrayContaining([expect.objectContaining({ type: 'image', data: 'base64-image' })]),
    )
  })
})
