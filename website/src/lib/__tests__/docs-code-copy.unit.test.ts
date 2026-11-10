// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODE_COPY_CLASS, enhanceDocsCodeCopy } from '../docs-code-copy'
import { INSTALL_COMMAND } from '../install-command'

const INSTALL = INSTALL_COMMAND

beforeEach(() => {
  document.body.innerHTML = `<article class="prose-docs"><pre><code>${INSTALL}\n</code></pre><p>Text</p><pre><code>openwaggle --help</code></pre></article>`
})

afterEach(() => {
  vi.useRealTimers()
})

function firstBlock() {
  const button = document.querySelector<HTMLButtonElement>(`.${CODE_COPY_CLASS}`)
  const status = document.querySelector<HTMLElement>(`.${CODE_COPY_CLASS}-status`)
  if (!button || !status) throw new Error('The first code block has no Copy button or status.')
  return { button, status }
}

async function settle() {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
}

describe('docs code copy buttons', () => {
  it('adds one Copy button per code block and copies the command without its trailing newline', async () => {
    const writeText = vi.fn(async () => undefined)
    expect(enhanceDocsCodeCopy(document, { writeText })).toBe(2)
    const { button } = firstBlock()
    button.click()
    await settle()
    expect(writeText).toHaveBeenCalledWith(INSTALL)
    expect(button.textContent).toBe('Copied')
  })

  it('announces Copied in a polite live region, and clears it with the label after two seconds', async () => {
    vi.useFakeTimers()
    enhanceDocsCodeCopy(document, { writeText: async () => undefined })
    const { button, status } = firstBlock()
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('')
    button.click()
    await settle()
    expect(status.textContent).toBe('Copied')
    vi.advanceTimersByTime(2000)
    expect(button.textContent).toBe('Copy')
    expect(status.textContent).toBe('')
  })

  it('announces a second copy within two seconds again, by clearing the live region first', async () => {
    vi.useFakeTimers()
    enhanceDocsCodeCopy(document, { writeText: async () => undefined })
    const { button, status } = firstBlock()
    button.click()
    await settle()
    expect(status.textContent).toBe('Copied')
    const announcements: string[] = []
    new MutationObserver(() => announcements.push(status.textContent ?? '')).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    vi.advanceTimersByTime(1000)
    button.click()
    await settle()
    expect(status.textContent).toBe('')
    vi.advanceTimersByTime(100)
    expect(status.textContent).toBe('Copied')
    await settle()
    expect(announcements).toEqual(['', 'Copied'])
    vi.advanceTimersByTime(2000)
    expect(button.textContent).toBe('Copy')
    expect(status.textContent).toBe('')
  })

  it('shows and announces Copy failed when the clipboard refuses the text', async () => {
    enhanceDocsCodeCopy(document, {
      writeText: async () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
    })
    const { button, status } = firstBlock()
    button.click()
    await settle()
    expect(button.textContent).toBe('Copy failed')
    expect(status.textContent).toBe('Copy failed')
  })

  it('shows Copy failed when the clipboard throws instead of rejecting', async () => {
    enhanceDocsCodeCopy(document, {
      writeText: () => {
        throw new Error('No clipboard access')
      },
    })
    const { button, status } = firstBlock()
    button.click()
    await settle()
    expect(button.textContent).toBe('Copy failed')
    expect(status.textContent).toBe('Copy failed')
  })

  it('does not add a second button when it runs again', () => {
    const clipboard = { writeText: async () => undefined }
    enhanceDocsCodeCopy(document, clipboard)
    expect(enhanceDocsCodeCopy(document, clipboard)).toBe(0)
    expect(document.querySelectorAll(`.${CODE_COPY_CLASS}`)).toHaveLength(2)
  })

  it('skips the code view inside a live extension example', () => {
    document.body.innerHTML = `<article class="prose-docs"><pre><code>pnpm add x</code></pre><div class="ow-extension-root"><pre class="ow-syntax-block"><span>1</span>{}</pre></div></article>`
    expect(enhanceDocsCodeCopy(document, { writeText: vi.fn(async () => undefined) })).toBe(1)
    expect(document.querySelector('.ow-extension-root .' + CODE_COPY_CLASS)).toBeNull()
  })

  it('leaves blocks plain without the Clipboard API', () => {
    expect(enhanceDocsCodeCopy(document, undefined)).toBe(0)
    expect(document.querySelector(`.${CODE_COPY_CLASS}`)).toBeNull()
  })
})
