import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { runtimeHarness } from './inline-visualization-host-runtime.test-harness'

describe('inline visualization host runtime state', () => {
  it('coalesces bounded JSON visualization state for the authenticated host', async () => {
    const { context, postedMessages } = runtimeHarness()

    expect(
      vm.runInContext(`window.openai.setVisualizationState({ selected: 'service-a' })`, context),
    ).toBe(true)
    expect(
      vm.runInContext(
        `window.openai.setVisualizationState({ selected: 'service-b', filters: ['errors'] })`,
        context,
      ),
    ).toBe(true)
    expect(
      postedMessages.filter(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'openwaggle:inline-visualization:state',
      ),
    ).toHaveLength(0)

    await Promise.resolve()

    expect(postedMessages).toContainEqual(
      expect.objectContaining({
        type: 'openwaggle:inline-visualization:state',
        state: { selected: 'service-b', filters: ['errors'] },
      }),
    )
  })

  it('rejects non-JSON and oversized visualization state', () => {
    const { postedMessages, runtimeWindow } = runtimeHarness()
    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(openai.setVisualizationState(cyclic)).toBe(false)
    expect(openai.setVisualizationState({ callback: () => undefined })).toBe(false)
    expect(openai.setVisualizationState({ value: 'x'.repeat(20_000) })).toBe(false)
    expect(postedMessages).not.toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:state' }),
    )
  })

  it('flushes a new selection before a same-interaction follow-up', () => {
    const { context, dispatchTrustedDocumentEvent, postedMessages } = runtimeHarness(true)

    dispatchTrustedDocumentEvent('click', () => {
      vm.runInContext(
        `window.openai.setVisualizationState({ selectedService: 'api' });
         window.openai.sendFollowUpMessage('Explain the selection');`,
        context,
      )
    })

    expect(
      postedMessages
        .filter(
          (message): message is { type: string } =>
            typeof message === 'object' && message !== null && 'type' in message,
        )
        .map((message) => message.type)
        .filter((type) => type.endsWith(':state') || type.endsWith(':follow-up')),
    ).toEqual([
      'openwaggle:inline-visualization:state',
      'openwaggle:inline-visualization:follow-up',
    ])
  })

  it('coalesces mutation and resize bursts to one measurement per animation frame', () => {
    const {
      dispatchMutations,
      dispatchResize,
      dispatchWindowEvent,
      flushAnimationFrames,
      mutationObserverOptions,
      postedMessages,
    } = runtimeHarness()
    const resizeMessages = () =>
      postedMessages.filter(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'openwaggle:inline-visualization:resize',
      )

    dispatchWindowEvent('DOMContentLoaded')
    expect(mutationObserverOptions).toContainEqual({
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
      childList: true,
      subtree: true,
      characterData: true,
    })
    expect(resizeMessages()).toHaveLength(1)
    for (let index = 0; index < 100; index += 1) {
      dispatchMutations()
      dispatchResize()
    }
    expect(resizeMessages()).toHaveLength(1)

    flushAnimationFrames()
    expect(resizeMessages()).toHaveLength(2)
  })
})
