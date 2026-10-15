import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMcpAppFrameSize } from '../use-mcp-app-frame-size'

afterEach(() => {
  vi.useRealTimers()
})

describe("an MCP App frame's size", () => {
  it('starts over for a new frame: 1 px, starting, and its own start timeout', () => {
    vi.useFakeTimers()
    const initialProps: { load: number | null } = { load: 1 }
    const hook = renderHook(({ load }) => useMcpAppFrameSize(load), { initialProps })
    act(() => hook.result.current.onHeightChange(300))
    expect(hook.result.current).toMatchObject({ state: 'running', frameHeight: 300 })

    hook.rerender({ load: null })
    hook.rerender({ load: 1 })

    expect(hook.result.current).toMatchObject({ state: 'starting', frameHeight: 1 })
    act(() => vi.advanceTimersByTime(15_000))
    expect(hook.result.current.state).toBe('stalled')
  })

  it('starts over when the App reloads its document, and can stall again', () => {
    vi.useFakeTimers()
    const hook = renderHook(({ load }) => useMcpAppFrameSize(load), { initialProps: { load: 1 } })
    act(() => hook.result.current.onHeightChange(300))

    hook.rerender({ load: 2 })

    expect(hook.result.current).toMatchObject({ state: 'starting', frameHeight: 1 })
    act(() => vi.advanceTimersByTime(15_000))
    expect(hook.result.current.state).toBe('stalled')
  })

  it('keeps its callbacks, which the bridge is created from, across renders', () => {
    const hook = renderHook(() => useMcpAppFrameSize(1))
    const { onHeightChange, onInitialized } = hook.result.current

    act(() => onInitialized())

    expect(hook.result.current.onHeightChange).toBe(onHeightChange)
    expect(hook.result.current.onInitialized).toBe(onInitialized)
  })
})
