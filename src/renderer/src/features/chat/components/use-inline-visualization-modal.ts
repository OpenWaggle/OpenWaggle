import { useEffect, useRef } from 'react'

function inertOutsideBranch(section: HTMLElement | null) {
  const inerted: Array<{ element: HTMLElement; previous: boolean }> = []
  let branch = section
  while (branch?.parentElement) {
    const parent = branch.parentElement
    for (const sibling of parent.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue
      inerted.push({ element: sibling, previous: sibling.inert })
      sibling.inert = true
    }
    if (parent === document.body) break
    branch = parent
  }
  return () => {
    for (const entry of inerted) entry.element.inert = entry.previous
  }
}

export function useInlineVisualizationModal(input: {
  readonly expanded: boolean
  readonly sectionRef: React.RefObject<HTMLElement | null>
  readonly closeButtonRef: React.RefObject<HTMLButtonElement | null>
  readonly onDismiss: () => void
}) {
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!input.expanded) return
    restoreFocusRef.current =
      input.closeButtonRef.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const section = input.sectionRef.current
    const transcriptContainer = section?.closest<HTMLElement>('[data-chat-transcript-container]')
    const previousContainerType = transcriptContainer?.style.containerType ?? ''
    if (transcriptContainer) transcriptContainer.style.containerType = 'normal'
    const restoreInert = inertOutsideBranch(section)
    const keepFocusInside = (event: FocusEvent) => {
      if (section && event.target instanceof Node && !section.contains(event.target)) {
        input.closeButtonRef.current?.focus()
      }
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      input.onDismiss()
    }
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('focusin', keepFocusInside)
    document.addEventListener('keydown', dismissOnEscape)
    input.closeButtonRef.current?.focus()
    return () => {
      document.removeEventListener('focusin', keepFocusInside)
      document.removeEventListener('keydown', dismissOnEscape)
      document.body.style.overflow = previousBodyOverflow
      if (transcriptContainer) transcriptContainer.style.containerType = previousContainerType
      restoreInert()
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
  }, [input.closeButtonRef, input.expanded, input.onDismiss, input.sectionRef])
}
