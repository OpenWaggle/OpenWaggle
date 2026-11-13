import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { reportFirstFrame } from '../first-frame'

class FakeStylesheetLink extends EventTarget {
  sheet: object | null = null
}

function fakePage(readyState: DocumentReadyState, links: readonly FakeStylesheetLink[] = []) {
  const events = new EventTarget()
  const layout = vi.fn()
  const state = { readyState }
  const page = fromPartial<Document>({
    get readyState() {
      return state.readyState
    },
    documentElement: fromPartial<HTMLElement>({ getBoundingClientRect: layout }),
    querySelectorAll: () => fromPartial<NodeListOf<HTMLLinkElement>>(links),
    addEventListener: (type: string, listener: () => void, options?: AddEventListenerOptions) =>
      events.addEventListener(type, listener, options),
  })
  const advance = (next: DocumentReadyState) => {
    state.readyState = next
    events.dispatchEvent(new Event('readystatechange'))
  }
  return { page, layout, advance }
}

describe('reportFirstFrame', () => {
  it('reports once the document is parsed, laid out, not before', () => {
    const { page, layout, advance } = fakePage('loading')
    const report = vi.fn()
    reportFirstFrame(page, report)
    expect(report).not.toHaveBeenCalled()
    advance('interactive')
    advance('complete')
    expect(report).toHaveBeenCalledTimes(1)
    expect(layout).toHaveBeenCalledTimes(1)
  })

  it('waits for every linked stylesheet, loaded or failed', async () => {
    const loaded = new FakeStylesheetLink()
    loaded.sheet = {}
    const loading = new FakeStylesheetLink()
    const failing = new FakeStylesheetLink()
    const { page } = fakePage('interactive', [loaded, loading, failing])
    const report = vi.fn()
    reportFirstFrame(page, report)
    loading.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(report).not.toHaveBeenCalled()
    failing.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
  })

  it('reports at once for a page already parsed and styled', () => {
    const { page } = fakePage('complete')
    const report = vi.fn()
    reportFirstFrame(page, report)
    expect(report).toHaveBeenCalledTimes(1)
  })
})
