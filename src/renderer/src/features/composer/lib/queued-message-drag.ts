/**
 * DOM side of dragging a queued message: the drag image, the placeholder, and the drop line.
 *
 * All of it lives on DOM nodes, not React state: re-rendering the row that started a native drag
 * mid-gesture cancels the drag, and silently.
 */

export const QUEUED_MESSAGE_ROW_SELECTOR = '[data-qa="queued-message-row"]'
const QUEUED_MESSAGE_TEXT_SELECTOR = '[data-qa="queued-message-text"]'
const DROP_TARGET_ATTRIBUTE = 'data-drop-target'
const DRAG_SOURCE_ATTRIBUTE = 'data-drag-source'

/** The drag image shows at most this many lines of a message, so a long one cannot cover the dock. */
const DRAG_IMAGE_TEXT_CLAMP_CLASS = 'line-clamp-3'
/** The drag image's frame, around the copied row; the pointer offset accounts for it. */
const DRAG_IMAGE_FRAME_WIDTH = 1
const DRAG_IMAGE_CLASS =
  'm-0 list-none rounded-lg border border-border-light bg-bg-secondary p-0 text-text-primary'
/** Far enough off screen for any window, still laid out, which `setDragImage` requires. */
const OFF_SCREEN_LEFT = '-10000px'

/** Attributes that make an element look like a live row to lookups, focus moves, or assistive tech. */
const ROW_IDENTITY_ATTRIBUTES = [
  'id',
  'data-qa',
  'data-follow-up-id',
  DROP_TARGET_ATTRIBUTE,
  DRAG_SOURCE_ATTRIBUTE,
]

export type QueuedMessageDropPosition = 'before' | 'after'

function stripRowIdentity(root: Element) {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of ROW_IDENTITY_ATTRIBUTES) element.removeAttribute(attribute)
  }
}

/** A copy of the row, the same width, framed on the dock's background, rendered off screen. */
function dragImageOf(row: HTMLElement, width: number) {
  const copy = row.cloneNode(true)
  if (!(copy instanceof HTMLElement)) return null
  copy.querySelector(QUEUED_MESSAGE_TEXT_SELECTOR)?.classList.add(DRAG_IMAGE_TEXT_CLAMP_CLASS)
  stripRowIdentity(copy)
  copy.style.width = `${String(width)}px`
  copy.style.boxSizing = 'border-box'

  const frame = document.createElement('ul')
  frame.className = DRAG_IMAGE_CLASS
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('inert', '')
  frame.style.position = 'fixed'
  frame.style.top = '0'
  frame.style.left = OFF_SCREEN_LEFT
  frame.style.pointerEvents = 'none'
  frame.append(copy)
  return frame
}

function clamp(value: number, max: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), max)
}

/**
 * Makes the whole row the drag image, held at the point the pointer took it. Without this the
 * browser drags an image of the grip alone.
 *
 * The image is a copy: dimming the row into a placeholder must not dim the image, and the copy
 * gets an opaque frame so it reads on any background. Chromium paints the image when `dragstart`
 * returns, so the copy must be in the document then; it is removed on the next task.
 */
export function setQueuedMessageDragImage(
  dataTransfer: DataTransfer,
  row: HTMLElement,
  pointer: { readonly clientX: number; readonly clientY: number },
) {
  const box = row.getBoundingClientRect()
  const image = dragImageOf(row, box.width)
  if (!image) return
  document.body.append(image)
  try {
    dataTransfer.setDragImage(
      image,
      clamp(pointer.clientX - box.left, box.width) + DRAG_IMAGE_FRAME_WIDTH,
      clamp(pointer.clientY - box.top, box.height) + DRAG_IMAGE_FRAME_WIDTH,
    )
  } finally {
    window.setTimeout(() => image.remove(), 0)
  }
}

/** Dims the row being dragged: it stays in place, as a placeholder, until the drag ends. */
export function markDragSource(row: HTMLElement) {
  row.setAttribute(DRAG_SOURCE_ATTRIBUTE, 'true')
}

/** Shows the drop line on `row`, on the side the message will land, and nowhere else. */
export function showDropLine(
  list: HTMLElement,
  row: HTMLElement,
  position: QueuedMessageDropPosition,
) {
  for (const other of list.querySelectorAll(`[${DROP_TARGET_ATTRIBUTE}]`)) {
    if (other !== row) other.removeAttribute(DROP_TARGET_ATTRIBUTE)
  }
  row.setAttribute(DROP_TARGET_ATTRIBUTE, position)
}

export function clearDropLine(list: HTMLElement | null) {
  for (const row of list?.querySelectorAll(`[${DROP_TARGET_ATTRIBUTE}]`) ?? []) {
    row.removeAttribute(DROP_TARGET_ATTRIBUTE)
  }
}

/** Ends every trace of a drag: the drop line and the placeholder. */
export function clearDragFeedback(list: HTMLElement | null) {
  clearDropLine(list)
  for (const row of list?.querySelectorAll(`[${DRAG_SOURCE_ATTRIBUTE}]`) ?? []) {
    row.removeAttribute(DRAG_SOURCE_ATTRIBUTE)
  }
}

/** The queued row an event happened in, if it is one of this list's. */
export function queuedRowAt(list: HTMLElement | null, target: EventTarget | null) {
  if (!list || !(target instanceof Element)) return null
  const row = target.closest<HTMLElement>(QUEUED_MESSAGE_ROW_SELECTOR)
  return row && list.contains(row) ? row : null
}
