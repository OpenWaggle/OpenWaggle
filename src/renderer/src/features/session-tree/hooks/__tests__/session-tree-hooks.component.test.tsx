import { SessionNodeId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { type RefObject, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { node, visibleRows } from '../../lib/__tests__/session-tree-test-fixtures'
import { useSessionTreeFilterMode } from '../useSessionTreeFilterMode'
import { useSessionTreeFocusSync } from '../useSessionTreeFocusSync'
import { useSessionTreeKeyboardControls } from '../useSessionTreeKeyboardControls'
import { useSessionTreeScrollControls } from '../useSessionTreeScrollControls'

type HotkeyCallback = () => void
interface HotkeyState {
  readonly handlers: Map<string, HotkeyCallback>
  readonly escapeCallbacks: HotkeyCallback[]
}

const hookMocks = vi.hoisted(() => {
  const hotkeyState: HotkeyState = { handlers: new Map(), escapeCallbacks: [] }
  return {
    getPiTreeFilterMode: vi.fn(),
    setPiTreeFilterMode: vi.fn(),
    hotkeyState,
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getPiTreeFilterMode: hookMocks.getPiTreeFilterMode,
    setPiTreeFilterMode: hookMocks.setPiTreeFilterMode,
  },
}))

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkey: (hotkey: string, callback: HotkeyCallback) => {
    hookMocks.hotkeyState.handlers.set(hotkey, callback)
  },
}))

vi.mock('@/shared/hooks/useEscapeHotkey', () => ({
  useEscapeHotkey: (callback: HotkeyCallback) => {
    hookMocks.hotkeyState.escapeCallbacks.push(callback)
  },
}))

function focusHarnessNodes(): readonly SessionNode[] {
  return [node({ id: 'root', depth: 0, order: 1 })]
}

function FocusHarness() {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const treeRowsRef = useRef<HTMLDivElement>(null)
  const nodes = focusHarnessNodes()
  useSessionTreeFocusSync({
    clampedFocusIndex: 0,
    rowRefs,
    treeRowsRef,
    visibleNodes: nodes,
  })
  return (
    <div ref={treeRowsRef}>
      <Button
        variant="unstyled"
        type="button"
        ref={(element) => {
          if (element) rowRefs.current.set('root', element)
        }}
      >
        Root row
      </Button>
    </div>
  )
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: {
    readonly scrollHeight: number
    readonly clientHeight: number
    readonly scrollTop: number
  },
) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    writable: true,
    value: metrics.scrollTop,
  })
}

function attachScrollContainer(ref: RefObject<HTMLDivElement | null>, element: HTMLDivElement) {
  Object.defineProperty(ref, 'current', { configurable: true, value: element })
}

describe('Session Tree hooks', () => {
  beforeEach(() => {
    hookMocks.getPiTreeFilterMode.mockReset()
    hookMocks.setPiTreeFilterMode.mockReset()
    hookMocks.hotkeyState.handlers.clear()
    hookMocks.hotkeyState.escapeCallbacks.length = 0
  })

  it('loads, validates, and persists the Pi Session Tree filter mode', async () => {
    hookMocks.getPiTreeFilterMode.mockResolvedValue('all')
    hookMocks.setPiTreeFilterMode.mockResolvedValue(undefined)
    const showToast = vi.fn()
    const { result } = renderHook(() => useSessionTreeFilterMode('/repo', showToast))

    await waitFor(() => expect(result.current.filterMode).toBe('all'))
    act(() => result.current.updateFilterMode('invalid'))
    act(() => result.current.updateFilterMode('default'))

    expect(result.current.filterMode).toBe('default')
    expect(hookMocks.setPiTreeFilterMode).toHaveBeenCalledWith('default', '/repo')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('shows a toast when the persisted filter cannot be loaded', async () => {
    hookMocks.getPiTreeFilterMode.mockRejectedValue(new Error('disk unavailable'))
    const showToast = vi.fn()

    renderHook(() => useSessionTreeFilterMode('/repo', showToast))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Failed to load Session Tree filter: disk unavailable',
      ),
    )
  })

  it('focuses the active visible row when the tree first mounts', () => {
    render(<FocusHarness />)

    expect(document.activeElement).toHaveTextContent('Root row')
  })

  it('registers keyboard controls for focus, selection, expansion, collapse, and close', () => {
    const rows = visibleRows({
      nodes: [
        node({ id: 'root', depth: 0, order: 1 }),
        node({ id: 'child', parentId: 'root', depth: 1, order: 2 }),
      ],
      expandedNodeIds: ['root'],
    })
    const onClose = vi.fn()
    const onFocusIndex = vi.fn()
    const onSelectNode = vi.fn()
    const onToggleNodeExpanded = vi.fn()

    renderHook(() =>
      useSessionTreeKeyboardControls({
        clampedFocusIndex: 0,
        focusIndex: 0,
        rowExpandedNodeIds: [SessionNodeId('root')],
        visibleRows: rows,
        onClose,
        onFocusIndex,
        onSelectNode,
        onToggleNodeExpanded,
      }),
    )

    hookMocks.hotkeyState.handlers.get('ArrowDown')?.()
    hookMocks.hotkeyState.handlers.get('Enter')?.()
    hookMocks.hotkeyState.handlers.get('ArrowRight')?.()
    hookMocks.hotkeyState.handlers.get('ArrowLeft')?.()
    hookMocks.hotkeyState.escapeCallbacks[0]?.()

    expect(onFocusIndex).toHaveBeenCalledWith(1)
    expect(onSelectNode).toHaveBeenCalledWith(rows[0]?.node)
    expect(onToggleNodeExpanded).toHaveBeenCalledWith(rows[0])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows and hides the scroll-to-bottom affordance based on tree scroll position', () => {
    const { result } = renderHook(() => useSessionTreeScrollControls())
    const element = document.createElement('div')
    attachScrollContainer(result.current.scrollContainerRef, element)
    setScrollMetrics(element, { scrollHeight: 400, clientHeight: 100, scrollTop: 0 })

    act(() => result.current.syncTreeScrollButtonVisibility())
    expect(result.current.showTreeScrollToBottom).toBe(true)

    act(() => result.current.scrollToTreeBottom())
    expect(result.current.showTreeScrollToBottom).toBe(false)
  })
})
