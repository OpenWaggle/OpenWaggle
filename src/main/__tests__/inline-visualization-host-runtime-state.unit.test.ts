import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
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

describe('inline visualization host runtime restored state', () => {
  it('exposes the restored state before fragment scripts run and tracks later reports', () => {
    const { context, restoredStateMetadata, runtimeWindow } = runtimeHarness(
      false,
      true,
      false,
      JSON.stringify({ selected: 'B' }),
    )
    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')

    expect(openai.visualizationState).toEqual({ selected: 'B' })
    expect(restoredStateMetadata.remove).toHaveBeenCalledOnce()
    const copy = openai.visualizationState
    if (typeof copy === 'object' && copy !== null) Reflect.set(copy, 'selected', 'tampered')
    expect(openai.visualizationState).toEqual({ selected: 'B' })

    // Fragment values come from the frame's own realm.
    expect(vm.runInContext(`window.openai.setVisualizationState({ selected: 'C' })`, context)).toBe(
      true,
    )
    expect(openai.visualizationState).toEqual({ selected: 'C' })
    expect(openai.setVisualizationState(null)).toBe(true)
    expect(openai.visualizationState).toBeNull()
  })

  it('starts without restored state on a first load or a malformed restore', () => {
    expect(runtimeHarness().runtimeWindow.openai?.visualizationState).toBeNull()
    expect(
      runtimeHarness(false, true, false, '{not json').runtimeWindow.openai?.visualizationState,
    ).toBeNull()
  })
})

describe('inline visualization host runtime Lucide placeholder', () => {
  it('defers icon calls made before the async runtime loads instead of crashing the fragment', () => {
    const { dispatchWindowEvent, loadScripts, postedMessages, runtimeWindow } = runtimeHarness()
    const placeholder = runtimeWindow.lucide
    if (!placeholder) throw new Error('Expected the Lucide placeholder.')

    expect(() => placeholder.createIcons({ attrs: { width: 14, height: 14 } })).not.toThrow()

    const createIcons = vi.fn()
    runtimeWindow.lucide = { createIcons }
    loadScripts()
    expect(createIcons).not.toHaveBeenCalled()

    dispatchWindowEvent('DOMContentLoaded')
    expect(createIcons.mock.calls).toEqual([[{ attrs: { width: 14, height: 14 } }], []])
    placeholder.createIcons({ attrs: { width: 16, height: 16 } })
    expect(createIcons).toHaveBeenLastCalledWith({ attrs: { width: 16, height: 16 } })
    expect(postedMessages).not.toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:error' }),
    )
  })
})
