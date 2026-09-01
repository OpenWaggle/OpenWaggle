import { useEffect, useRef } from 'react'

export function useInlineVisualizationModal(input: {
  readonly expanded: boolean
  readonly sectionRef: React.RefObject<HTMLElement | null>
  readonly closeButtonRef: React.RefObject<HTMLButtonElement | null>
}) {
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!input.expanded) return
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const section = input.sectionRef.current
    const inerted: Array<{ element: HTMLElement; previous: boolean }> = []
    let branch: HTMLElement | null = section
    while (branch?.parentElement && branch.parentElement !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (
          sibling !== branch &&
          sibling instanceof HTMLElement &&
          !sibling.dataset.visualizationBackdrop
        ) {
          inerted.push({ element: sibling, previous: sibling.inert })
          sibling.inert = true
        }
      }
      branch = branch.parentElement
    }
    const keepFocusInside = (event: FocusEvent) => {
      if (section && event.target instanceof Node && !section.contains(event.target)) {
        input.closeButtonRef.current?.focus()
      }
    }
    document.addEventListener('focusin', keepFocusInside)
    input.closeButtonRef.current?.focus()
    return () => {
      document.removeEventListener('focusin', keepFocusInside)
      for (const entry of inerted) entry.element.inert = entry.previous
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
  }, [input.closeButtonRef, input.expanded, input.sectionRef])
}
