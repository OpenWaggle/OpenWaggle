import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMcpAppFrameLayout } from '../use-mcp-app-frame-layout'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

function layoutFor(element: HTMLElement | null) {
  return renderHook(() => useMcpAppFrameLayout({ current: element }))
}

describe("an MCP App frame's layout", () => {
  it("follows OpenWaggle's appearance, which the page records in data-theme", async () => {
    document.documentElement.setAttribute('data-theme', 'light')
    const { result } = layoutFor(null)
    expect(result.current.theme).toBe('light')

    act(() => document.documentElement.setAttribute('data-theme', 'high-contrast-dark'))

    await waitFor(() => expect(result.current.theme).toBe('dark'))
  })

  it('is dark by default, as OpenWaggle is', () => {
    expect(layoutFor(null).result.current.theme).toBe('dark')
  })

  it('measures the frame width, and again whenever the panel resizes', () => {
    const observers: Array<{ readonly callback: () => void; disconnected: boolean }> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly entry: { readonly callback: () => void; disconnected: boolean }
        constructor(callback: () => void) {
          this.entry = { callback, disconnected: false }
          observers.push(this.entry)
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true
        }
      },
    )
    const element = document.createElement('div')
    let width = 678
    element.getBoundingClientRect = () => DOMRect.fromRect({ width, height: 10 })

    const hook = layoutFor(element)
    expect(hook.result.current.width).toBe(678)

    width = 494
    act(() => observers[0]?.callback())
    expect(hook.result.current.width).toBe(494)

    hook.unmount()
    expect(observers[0]?.disconnected).toBe(true)
    vi.unstubAllGlobals()
  })
})
