import { useCallback, useEffect, useRef } from 'react'

/** The roles that make an element an item of a menu, per ARIA. */
const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]'

/**
 * The keyboard model the `menu` role promises.
 *
 * Arrow keys and Home and End move between items, the panel is a single tab stop, Tab leaves it,
 * focus enters on open and returns to whatever opened it on close. Declaring `role="menu"` without
 * this tells a screen reader user to press keys that do nothing, so the two belong together.
 *
 * Items are found in the DOM rather than registered by each consumer, because a menu's items are
 * arbitrary children and every call site would otherwise have to wire the same plumbing.
 */
export function useMenuKeyboard(input: {
  readonly enabled: boolean
  readonly isOpen: boolean
  readonly panelRef: React.RefObject<HTMLElement | null>
  readonly onClose: () => void
}) {
  const { enabled, isOpen, panelRef, onClose } = input
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  /** The panel's enabled items, in document order. */
  const items = useCallback(() => {
    const panel = panelRef.current
    if (panel === null) return []
    return [...panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)].filter(
      (item) => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true',
    )
  }, [panelRef])

  /**
   * Move focus to one item and make it the panel's only tab stop.
   *
   * A menu is a single tab stop with arrow keys inside it, so every other item leaves the tab
   * order rather than staying focusable.
   */
  const focusItemAt = useCallback((list: readonly HTMLElement[], index: number) => {
    list.forEach((item, position) => {
      item.tabIndex = position === index ? 0 : -1
    })
    list[index]?.focus()
  }, [])

  // Focus enters on open, landing on the checked item so the current choice is what gets announced.
  useEffect(() => {
    if (!enabled || !isOpen) return
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const list = items()
    if (list.length === 0) return
    const checkedIndex = list.findIndex((item) => item.getAttribute('aria-checked') === 'true')
    focusItemAt(list, checkedIndex === -1 ? 0 : checkedIndex)
  }, [enabled, isOpen, items, focusItemAt])

  /*
   * Focus returns to whatever opened the menu, but only when the menu still held it.
   *
   * Closing by clicking something else already moved focus deliberately, and taking it back would
   * undo the user's own action.
   */
  useEffect(() => {
    if (!enabled || isOpen) return
    const origin = restoreFocusRef.current
    restoreFocusRef.current = null
    if (origin === null || !origin.isConnected) return
    const active = document.activeElement
    if (active === null || active === document.body) origin.focus()
  }, [enabled, isOpen])

  return useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!enabled) return

      // Tab leaves a menu rather than moving inside it, so the panel closes and the page continues.
      if (event.key === 'Tab') {
        onClose()
        return
      }

      const list = items()
      if (list.length === 0) return
      const active = document.activeElement
      const current = active instanceof HTMLElement ? list.indexOf(active) : -1

      const target = MENU_KEY_TARGET[event.key]
      if (target === undefined) return

      event.preventDefault()
      const next = target({ current, count: list.length })
      focusItemAt(list, ((next % list.length) + list.length) % list.length)
    },
    [enabled, items, focusItemAt, onClose],
  )
}

/** Where each navigation key sends focus, given the current position. */
const MENU_KEY_TARGET: Record<
  string,
  ((position: { readonly current: number; readonly count: number }) => number) | undefined
> = {
  ArrowDown: ({ current }) => current + 1,
  ArrowUp: ({ current }) => current - 1,
  Home: () => 0,
  End: ({ count }) => count - 1,
}
