import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'
import { RightSidebarLayout, sidebarWidthValue } from '../RightSidebarLayout'
import type { WidthAcceptanceContext } from '../right-sidebar-layout-types'

import {
  ACCEPTED_WIDTH,
  DEFAULT_CLAMPED_WIDTH,
  DEFAULT_WIDTH_PX,
  installAnimationFrame,
  installMatchMedia,
  layoutProps,
  MAIN_MIN_WIDTH_PX,
  MAX_WIDTH_PX,
  PERSISTED_CLAMPED_WIDTH,
  POINTER_ID,
  prepareDockedResize,
  renderLayout,
  START_X,
  STORAGE_KEY,
} from './right-sidebar-layout.test-harness'

describe('RightSidebarLayout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installMatchMedia(false)
    vi.restoreAllMocks()
  })

  it('preserves the main input, focus, and selection across responsive breakpoints', () => {
    const setSheet = installMatchMedia(false)
    render(
      <RightSidebarLayout {...layoutProps(false)}>
        <textarea aria-label="Draft" defaultValue="Keep my draft" />
      </RightSidebarLayout>,
    )
    const input = screen.getByRole('textbox', { name: 'Draft' })
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Expected draft textarea')
    input.focus()
    input.setSelectionRange(3, 7)

    for (const isSheet of [true, false, true, false]) {
      act(() => setSheet(isSheet))
      expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input)
      expect(input).toHaveFocus()
      expect(input).toHaveValue('Keep my draft')
      expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7])
    }
  })

  it('keeps sidebar content mounted after the first open so close can animate', () => {
    const view = renderLayout(false)

    expect(screen.queryByText('Diff content')).toBeNull()
    expect(document.querySelector('[data-right-sidebar-shell="true"]')).toHaveStyle({
      width: '0px',
    })

    view.rerender(
      <RightSidebarLayout {...layoutProps(true)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Diff content')).toBeInTheDocument()

    view.rerender(
      <RightSidebarLayout {...layoutProps(false)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Diff content')).toBeInTheDocument()
  })

  it('uses the left-sidebar width clipping motion for docked open and close', () => {
    const view = renderLayout(true)

    const sidebar = document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')
    const panel = document.querySelector<HTMLElement>('[data-right-sidebar-panel="true"]')

    expect(sidebarWidthValue(DEFAULT_WIDTH_PX, MAIN_MIN_WIDTH_PX)).toBe(DEFAULT_CLAMPED_WIDTH)
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', '600')
    expect(sidebar).toHaveAttribute('data-right-sidebar-main-min-width', '420')
    expect(sidebar).toHaveClass('transition-[width]', 'duration-200', 'ease-out')
    expect(panel).toHaveStyle({ width: '100%' })
    expect(panel?.getAttribute('style')).not.toContain('transform')

    view.rerender(
      <RightSidebarLayout {...layoutProps(false)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')).toHaveStyle({
      width: '0px',
    })
  })

  it('restores a persisted inline sidebar width', () => {
    window.localStorage.setItem(STORAGE_KEY, '720')

    renderLayout(true)

    const sidebar = document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')

    expect(sidebarWidthValue(720, MAIN_MIN_WIDTH_PX)).toBe(PERSISTED_CLAMPED_WIDTH)
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', '720')
  })

  it('maximizes without unmounting main content and restores the exact retained width', () => {
    window.localStorage.setItem(STORAGE_KEY, '720')
    const view = render(
      <RightSidebarLayout {...layoutProps(true, vi.fn(), false)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )
    const originalMainContent = screen.getByText('Main content')

    view.rerender(
      <RightSidebarLayout {...layoutProps(true, vi.fn(), true)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Main content')).toBe(originalMainContent)
    expect(document.querySelector('[data-right-sidebar-main="true"]')).toHaveAttribute('inert')
    expect(document.querySelector('[data-right-sidebar-shell="true"]')).toHaveStyle({
      width: '100%',
    })
    expect(screen.queryByRole('button', { name: 'Resize right sidebar' })).toBeNull()

    view.rerender(
      <RightSidebarLayout {...layoutProps(true, vi.fn(), false)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Main content')).toBe(originalMainContent)
    expect(document.querySelector('[data-right-sidebar-main="true"]')).not.toHaveAttribute('inert')
    expect(document.querySelector('[data-right-sidebar-shell="true"]')).toHaveAttribute(
      'data-right-sidebar-maximized',
      'false',
    )
    expect(document.querySelector('[data-right-sidebar-shell="true"]')).toHaveAttribute(
      'data-right-sidebar-preferred-width',
      '720',
    )
    expect(sidebarWidthValue(720, MAIN_MIN_WIDTH_PX)).toBe(PERSISTED_CLAMPED_WIDTH)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('720')
  })

  it('renders a dismissible sheet when the viewport is below the sidebar breakpoint', () => {
    installMatchMedia(true)
    const onOpenChange = vi.fn()

    renderLayout(true, onOpenChange)

    expect(document.querySelector('[data-right-sidebar-shell="true"]')).toBeVisible()
    expect(screen.getByText('Main content').parentElement).toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('preserves the main draft and focus across both responsive sidebar modes', () => {
    const content = <textarea aria-label="Draft" defaultValue="" />
    const view = render(<RightSidebarLayout {...layoutProps(false)}>{content}</RightSidebarLayout>)
    const draft = screen.getByRole('textbox', { name: 'Draft' })
    fireEvent.change(draft, { target: { value: 'Unsent draft' } })
    draft.focus()

    for (const isSheet of [true, false, true, false]) {
      installMatchMedia(isSheet)
      view.rerender(<RightSidebarLayout {...layoutProps(false)}>{content}</RightSidebarLayout>)
      expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsent draft')
      expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveFocus()
    }
  })

  it('moves focus into a docked sidebar when it opens', async () => {
    const view = renderLayout(false)
    view.rerender(
      <RightSidebarLayout {...layoutProps(true)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Diff content' })).toHaveFocus())
  })

  it('moves focus into a sidebar sheet when it opens', async () => {
    installMatchMedia(true)
    renderLayout(true)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Diff content' })).toHaveFocus())
  })

  it('keeps an open sidebar focused when moving between sheet and docked modes', async () => {
    const view = renderLayout(true)
    for (const isSheet of [true, false]) {
      installMatchMedia(isSheet)
      view.rerender(
        <RightSidebarLayout {...layoutProps(true)}>
          <div>Main content</div>
        </RightSidebarLayout>,
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Diff content' })).toHaveFocus(),
      )
    }
  })

  it.each([false, true])(
    'returns focus after closing a resized sheet with child autofocus %s',
    async (autoFocus) => {
      const props = {
        ...layoutProps(true),
        sidebar: <Button autoFocus={autoFocus}>Diff content</Button>,
      }
      const view = render(
        <RightSidebarLayout {...props}>
          <div>Main content</div>
        </RightSidebarLayout>,
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Diff content' })).toHaveFocus(),
      )
      installMatchMedia(true)
      view.rerender(
        <RightSidebarLayout {...props}>
          <div>Main content</div>
        </RightSidebarLayout>,
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Diff content' })).toHaveFocus(),
      )
      view.rerender(
        <RightSidebarLayout {...props} open={false}>
          <div>Main content</div>
        </RightSidebarLayout>,
      )
      await waitFor(() =>
        expect(document.querySelector('[data-right-sidebar-main="true"]')).toHaveFocus(),
      )
    },
  )

  it('grows left, clamps before acceptance, previews accepted widths, and persists on release', () => {
    const animationFrame = installAnimationFrame()
    const shouldAcceptWidth = vi.fn((context: WidthAcceptanceContext) => {
      return context.nextWidth <= ACCEPTED_WIDTH
    })
    render(
      <RightSidebarLayout {...layoutProps(true)} shouldAcceptWidth={shouldAcceptWidth}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )
    const { panel, rail, releasePointerCapture, root, setPointerCapture, sidebar } =
      prepareDockedResize()

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    expect(setPointerCapture).toHaveBeenCalledWith(POINTER_ID)
    expect(document.body).toHaveClass('right-sidebar-resizing')
    expect(panel.style.transitionDuration).toBe('0ms')
    expect(sidebar.style.transitionDuration).toBe('0ms')

    fireEvent.pointerMove(rail, { clientX: -500, pointerId: POINTER_ID })
    animationFrame.flush()
    expect(shouldAcceptWidth).toHaveBeenLastCalledWith({
      nextWidth: MAX_WIDTH_PX,
      panel,
      root,
      sidebar,
    })
    expect(sidebar).toHaveStyle({ width: `${String(DEFAULT_WIDTH_PX)}px` })

    fireEvent.pointerMove(rail, { clientX: 700, pointerId: POINTER_ID })
    animationFrame.flush()
    expect(shouldAcceptWidth).toHaveBeenLastCalledWith({
      nextWidth: ACCEPTED_WIDTH,
      panel,
      root,
      sidebar,
    })
    expect(rail).toHaveStyle({ right: '692px' })

    fireEvent.pointerUp(rail, { clientX: 700, pointerId: POINTER_ID })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(ACCEPTED_WIDTH))
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', String(ACCEPTED_WIDTH))
    expect(document.body).not.toHaveClass('right-sidebar-resizing')
    expect(panel.style.transitionDuration).toBe('')
    expect(sidebar.style.transitionDuration).toBe('')
    expect(releasePointerCapture).toHaveBeenCalledWith(POINTER_ID)
  })

  it('does not commit movement inside the drag threshold', () => {
    const animationFrame = installAnimationFrame()
    renderLayout(true)
    const { rail, sidebar } = prepareDockedResize()

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    fireEvent.pointerMove(rail, { clientX: 799, pointerId: POINTER_ID })
    animationFrame.flush()
    fireEvent.pointerUp(rail, { clientX: 799, pointerId: POINTER_ID })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', String(DEFAULT_WIDTH_PX))
  })

  it('cancels pending work and restores global and element state when unmounted', () => {
    const animationFrame = installAnimationFrame()
    const view = renderLayout(true)
    const { panel, rail, releasePointerCapture, sidebar } = prepareDockedResize()

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    fireEvent.pointerMove(rail, { clientX: 700, pointerId: POINTER_ID })
    view.unmount()

    expect(animationFrame.cancelAnimationFrame).toHaveBeenCalled()
    expect(releasePointerCapture).toHaveBeenCalledWith(POINTER_ID)
    expect(document.body).not.toHaveClass('right-sidebar-resizing')
    expect(panel.style.transitionDuration).toBe('')
    expect(sidebar.style.transitionDuration).toBe('')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
