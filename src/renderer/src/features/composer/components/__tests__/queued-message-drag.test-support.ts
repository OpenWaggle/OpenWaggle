import { createEvent, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

/** A DataTransfer stand-in: jsdom does not implement one, nor DragEvent's pointer fields. */
export function makeDataTransfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: vi.fn<(image: Element, x: number, y: number) => void>(),
  }
}

export type FakeDataTransfer = ReturnType<typeof makeDataTransfer>

type DragEventName = 'dragStart' | 'dragOver' | 'dragLeave' | 'drop' | 'dragEnd'

/**
 * Fires a drag event with the fields jsdom leaves out: the pointer position and, for
 * `dragleave`, where the pointer went. Returns false when a handler called preventDefault.
 */
export function fireDrag(
  name: DragEventName,
  target: Element,
  dataTransfer: FakeDataTransfer,
  fields: {
    readonly clientX?: number
    readonly clientY?: number
    readonly relatedTarget?: Element | null
  } = {},
) {
  const event = createEvent[name](target, { dataTransfer })
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(event, key, { value })
  }
  return fireEvent(target, event)
}

/** Gives an element a layout box: jsdom lays nothing out. */
export function placeElement(
  element: Element,
  box: { left: number; top: number; width: number; height: number },
) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(box.left, box.top, box.width, box.height),
  )
}
