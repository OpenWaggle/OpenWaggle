import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewViewportResizeHandles } from '../BrowserPreviewViewportResizeHandles'

const LAYOUT = {
  x: 100,
  y: 50,
  width: 400,
  height: 300,
  scale: 1,
  fillsContainer: false,
} as const

describe('BrowserPreviewViewportResizeHandles', () => {
  it('exposes the five T3-compatible rails with keyboard guidance', () => {
    render(
      <BrowserPreviewViewportResizeHandles
        activeDirection={null}
        handlers={{ onKeyDown: vi.fn(), onPointerDown: vi.fn() }}
        layout={LAYOUT}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(
      screen.getByRole('button', {
        name: 'Resize browser viewport from left edge. Use arrow keys to resize.',
      }),
    ).toHaveStyle({ left: '90px', top: '50px', width: '10px', height: '300px' })
    expect(
      screen.getByRole('button', {
        name: 'Resize browser viewport from right edge. Use arrow keys to resize.',
      }),
    ).toHaveStyle({ left: '500px', top: '50px', width: '10px', height: '300px' })
    expect(
      screen.getByRole('button', {
        name: 'Resize browser viewport from bottom edge. Use arrow keys to resize.',
      }),
    ).toHaveStyle({ left: '100px', top: '350px', width: '400px', height: '10px' })
    expect(
      screen.getByRole('button', {
        name: 'Resize browser viewport from bottom-left corner. Use arrow keys to resize.',
      }),
    ).toHaveStyle({ left: '90px', top: '350px', width: '10px', height: '10px' })
    expect(
      screen.getByRole('button', {
        name: 'Resize browser viewport from bottom-right corner. Use arrow keys to resize.',
      }),
    ).toHaveStyle({ left: '500px', top: '350px', width: '10px', height: '10px' })
  })

  it('routes keyboard and pointer input with the active direction visible', () => {
    const onKeyDown = vi.fn()
    const onPointerDown = vi.fn()
    render(
      <BrowserPreviewViewportResizeHandles
        activeDirection="southeast"
        handlers={{ onKeyDown, onPointerDown }}
        layout={LAYOUT}
      />,
    )
    const east = screen.getByRole('button', {
      name: 'Resize browser viewport from right edge. Use arrow keys to resize.',
    })
    const southeast = screen.getByRole('button', {
      name: 'Resize browser viewport from bottom-right corner. Use arrow keys to resize.',
    })

    fireEvent.keyDown(east, { key: 'ArrowRight' })
    fireEvent.pointerDown(southeast, { pointerId: 7, clientX: 500, clientY: 350 })

    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(onKeyDown.mock.calls[0]?.[0]).toBe('east')
    expect(onPointerDown).toHaveBeenCalledOnce()
    expect(onPointerDown.mock.calls[0]?.[0]).toBe('southeast')
    expect(southeast.querySelector('.text-text-primary')).not.toBeNull()
  })
})
