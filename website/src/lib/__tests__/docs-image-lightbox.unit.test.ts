// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enhanceDocsImageLightbox, LIGHTBOX_IDS } from '../docs-image-lightbox'

// jsdom has HTMLDialogElement but no modal behaviour; these stand in for the browser's.
function installDialogBehaviour() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

const PAGE = `
  <p><a href="/screenshots/hive.png" class="docs-image-link"><img src="/screenshots/hive.png" alt="The Hive panel"><span class="docs-visually-hidden"> (open full size)</span></a></p>
  <p><a href="/docs/other/" id="plain-link">Another page</a></p>
  <dialog id="${LIGHTBOX_IDS.dialog}">
    <img id="${LIGHTBOX_IDS.image}" alt="">
    <a id="${LIGHTBOX_IDS.original}" href="/">Open image file</a>
    <form method="dialog"><button id="${LIGHTBOX_IDS.close}" type="submit">Close</button></form>
  </dialog>
`

function element<T extends Element>(id: string, type: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof type)) throw new Error(`#${id} is missing.`)
  return found
}

function click(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  target.dispatchEvent(event)
  return event
}

describe('the docs image lightbox', () => {
  let dialog: HTMLDialogElement
  let thumbnail: HTMLImageElement
  let unwire: (() => void) | null = null

  beforeEach(() => {
    installDialogBehaviour()
    document.body.innerHTML = PAGE
    unwire = enhanceDocsImageLightbox(document)
    expect(unwire).toBeTypeOf('function')
    dialog = element(LIGHTBOX_IDS.dialog, HTMLDialogElement)
    const link = document.querySelector('a.docs-image-link img')
    if (!(link instanceof HTMLImageElement)) throw new Error('The thumbnail is missing.')
    thumbnail = link
  })

  afterEach(() => {
    unwire?.()
    document.body.innerHTML = ''
  })

  it('opens a clicked image in the dialog with its alt text, and focuses Close', () => {
    const event = click(thumbnail)
    expect(event.defaultPrevented).toBe(true)
    expect(dialog.open).toBe(true)
    const image = element(LIGHTBOX_IDS.image, HTMLImageElement)
    expect(image.src).toBe(new URL('/screenshots/hive.png', document.baseURI).href)
    expect(image.alt).toBe('The Hive panel')
    expect(element(LIGHTBOX_IDS.original, HTMLAnchorElement).href).toBe(image.src)
    expect(document.activeElement).toBe(element(LIGHTBOX_IDS.close, HTMLButtonElement))
  })

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)(
    'lets the link open the image file when %s is held',
    (key) => {
      const event = click(thumbnail, { [key]: true })
      expect(event.defaultPrevented).toBe(false)
      expect(dialog.open).toBe(false)
    },
  )

  it('ignores a middle click and other links', () => {
    expect(click(thumbnail, { button: 1 }).defaultPrevented).toBe(false)
    expect(click(element('plain-link', HTMLAnchorElement)).defaultPrevented).toBe(false)
    expect(dialog.open).toBe(false)
  })

  it('closes on a click on the backdrop or the image, but not on the file link', () => {
    click(thumbnail)
    click(element(LIGHTBOX_IDS.original, HTMLAnchorElement))
    expect(dialog.open).toBe(true)
    click(dialog)
    expect(dialog.open).toBe(false)
    click(thumbnail)
    click(element(LIGHTBOX_IDS.image, HTMLImageElement))
    expect(dialog.open).toBe(false)
  })

  it('returns focus to the image link when the dialog closes', () => {
    const link = thumbnail.closest('a')
    click(thumbnail)
    expect(document.activeElement).not.toBe(link)
    dialog.close()
    expect(document.activeElement).toBe(link)
  })

  it('leaves every link a plain link when the browser has no modal dialog', () => {
    unwire?.()
    document.body.innerHTML = PAGE
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    unwire = enhanceDocsImageLightbox(document)
    expect(unwire).toBeNull()
    const link = document.querySelector('a.docs-image-link img')
    if (!link) throw new Error('The thumbnail is missing.')
    expect(click(link).defaultPrevented).toBe(false)
  })
})
