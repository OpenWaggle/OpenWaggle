import type { LexicalEditor } from 'lexical'
import type { ReactNode, RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import type { UseFileAttachmentResult } from '../hooks/useFileAttachment'
import { ComposerDropOverlay } from './ComposerDropOverlay'

const COMPOSER_FOCUS_EXCLUSION_SELECTOR = [
  'a',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[data-composer-focus-exempt]',
  '[role="button"]',
  '[role="combobox"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="option"]',
].join(',')

interface ComposerDropZoneProps {
  readonly fileAttachment: UseFileAttachmentResult
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly editorRef: RefObject<LexicalEditor | null>
}

function shouldFocusEditor(event: MouseEvent, disabled: boolean) {
  if (disabled || event.button !== 0 || !(event.target instanceof Element)) return false
  return event.target.closest(COMPOSER_FOCUS_EXCLUSION_SELECTOR) === null
}

export function ComposerDropZone({
  fileAttachment,
  children,
  disabled = false,
  editorRef,
}: ComposerDropZoneProps) {
  const surfaceRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    // This only widens the pointer hit area of the real textbox. The section must not
    // masquerade as a keyboard control or become an extra stop in the tab order.
    function focusEditorFromSurface(event: MouseEvent) {
      if (!shouldFocusEditor(event, disabled)) return
      event.preventDefault()
      editorRef.current?.focus()
      // The DOM can paint one effect before EditorRefPlugin publishes the Lexical
      // instance, and Lexical may defer its own DOM focus. Keep the widened hit
      // area honest in both cases; focusing the same root preserves its selection.
      if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
      }
    }

    surface.addEventListener('mousedown', focusEditorFromSurface)
    return () => surface.removeEventListener('mousedown', focusEditorFromSurface)
  }, [disabled, editorRef])

  return (
    <section
      ref={surfaceRef}
      aria-label="Composer file drop zone"
      className={cn(
        'relative rounded-xl bg-bg-secondary border transition-all [&_button]:cursor-default',
        disabled ? 'cursor-default' : 'cursor-text',
        'border-input-card-border',
        'focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20',
        fileAttachment.isDragOver &&
          !fileAttachment.isAtCapacity &&
          'border-accent ring-2 ring-accent/30',
        fileAttachment.isDragOver &&
          fileAttachment.isAtCapacity &&
          'border-error/60 ring-2 ring-error/20',
      )}
      onDragEnter={fileAttachment.handleDragEnter}
      onDragLeave={fileAttachment.handleDragLeave}
      onDragOver={fileAttachment.handleDragOver}
      onDrop={(event) => {
        void fileAttachment.handleDrop(event)
      }}
    >
      {fileAttachment.isDragOver ? (
        <ComposerDropOverlay isAtCapacity={fileAttachment.isAtCapacity} />
      ) : null}
      {children}
    </section>
  )
}
