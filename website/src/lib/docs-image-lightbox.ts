import { ZOOMABLE_IMAGE_CLASS } from './markdown-images'

// Opens a docs image link (markdown-images.ts) in the page's modal dialog instead of leaving the
// page. Without JavaScript, or with a modifier key held, the link opens the image file itself.
// The native <dialog> keeps focus inside and closes on Escape. Closing returns focus to the link
// explicitly: Safari does not focus a link on click, so the browser's own restore can miss it.

export const LIGHTBOX_IDS = {
  dialog: 'docs-image-lightbox',
  image: 'docs-image-lightbox-image',
  original: 'docs-image-lightbox-original',
  close: 'docs-image-lightbox-close',
} as const

const PRIMARY_BUTTON = 0

/**
 * Wires the lightbox in `root` and returns a function that unwires it. Returns null, leaving every
 * link a plain link to its file, when the dialog is missing or the browser cannot open a modal
 * dialog.
 */
export function enhanceDocsImageLightbox(root: Document): (() => void) | null {
  const dialog = root.getElementById(LIGHTBOX_IDS.dialog)
  const image = root.getElementById(LIGHTBOX_IDS.image)
  const original = root.getElementById(LIGHTBOX_IDS.original)
  const close = root.getElementById(LIGHTBOX_IDS.close)
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(image instanceof HTMLImageElement) ||
    !(original instanceof HTMLAnchorElement) ||
    !(close instanceof HTMLButtonElement) ||
    typeof dialog.showModal !== 'function'
  ) {
    return null
  }

  const listeners = new AbortController()
  let opener: HTMLAnchorElement | null = null
  root.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== PRIMARY_BUTTON) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!(event.target instanceof Element)) return
      const link = event.target.closest(`a.${ZOOMABLE_IMAGE_CLASS}`)
      if (!(link instanceof HTMLAnchorElement)) return
      event.preventDefault()
      opener = link
      image.src = link.href
      image.alt = link.querySelector('img')?.alt ?? ''
      original.href = link.href
      dialog.showModal()
      close.focus()
    },
    { signal: listeners.signal },
  )

  dialog.addEventListener(
    'close',
    () => {
      opener?.focus()
      opener = null
    },
    { signal: listeners.signal },
  )

  // A click on the image or the backdrop closes the dialog; the buttons keep their own action.
  dialog.addEventListener(
    'click',
    (event) => {
      if (event.target === dialog || event.target === image) dialog.close()
    },
    { signal: listeners.signal },
  )
  return () => listeners.abort()
}
