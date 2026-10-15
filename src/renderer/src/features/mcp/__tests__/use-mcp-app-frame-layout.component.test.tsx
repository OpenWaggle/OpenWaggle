import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
})
