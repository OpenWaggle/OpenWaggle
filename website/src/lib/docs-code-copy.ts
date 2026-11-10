// Adds a Copy button to every docs code block, so a reader can paste an install or setup command
// without selecting it by hand. Without JavaScript or the Clipboard API, blocks stay plain text.
// Diagrams rendered from ```mermaid are not <pre> blocks, so they get no button.

export const CODE_COPY_CLASS = 'docs-code-copy'
const COPIED_LABEL = 'Copied'
const COPY_FAILED_LABEL = 'Copy failed'
const COPY_LABEL = 'Copy'
const RESET_AFTER_MS = 2000
/**
 * A live region announces a change, so a repeated copy first clears the status, then sets it again
 * after this long, which screen readers hear as a new message.
 */
const REANNOUNCE_AFTER_MS = 100

/** The text a Copy button puts on the clipboard: the block's code without the trailing newline. */
export function codeBlockText(pre: HTMLPreElement) {
  return (pre.querySelector('code') ?? pre).textContent?.replace(/\n+$/u, '') ?? ''
}

/**
 * Adds a Copy button to each `pre` under `root` and returns how many it added. Adds none when the
 * Clipboard API is unavailable (an insecure origin, or an old browser). The button shows Copied or
 * Copy failed for two seconds, and a polite live region beside it says the same to screen readers,
 * because the button's accessible name stays "Copy code to clipboard". A second copy while the
 * status still shows is announced again.
 */
export function enhanceDocsCodeCopy(
  root: Document | HTMLElement,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard,
) {
  if (!clipboard) return 0
  let added = 0
  for (const pre of root.querySelectorAll<HTMLPreElement>('.prose-docs pre')) {
    if (pre.parentElement?.classList.contains(`${CODE_COPY_CLASS}-wrap`)) continue
    // A live extension example renders its own code view, line numbers included. It is not a snippet to copy.
    if (pre.closest('.ow-extension-root')) continue
    const wrap = pre.ownerDocument.createElement('div')
    wrap.className = `${CODE_COPY_CLASS}-wrap`
    pre.replaceWith(wrap)
    wrap.append(pre)
    const button = pre.ownerDocument.createElement('button')
    button.type = 'button'
    button.className = CODE_COPY_CLASS
    button.textContent = COPY_LABEL
    button.setAttribute('aria-label', 'Copy code to clipboard')
    const status = pre.ownerDocument.createElement('span')
    status.className = `${CODE_COPY_CLASS}-status`
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    let reset: ReturnType<typeof setTimeout> | undefined
    let announce: ReturnType<typeof setTimeout> | undefined
    const show = (label: string) => {
      button.textContent = label
      clearTimeout(announce)
      if (status.textContent === '') {
        status.textContent = label
      } else {
        status.textContent = ''
        announce = setTimeout(() => {
          status.textContent = label
        }, REANNOUNCE_AFTER_MS)
      }
      clearTimeout(reset)
      reset = setTimeout(() => {
        clearTimeout(announce)
        button.textContent = COPY_LABEL
        status.textContent = ''
      }, RESET_AFTER_MS)
    }
    button.addEventListener('click', () => {
      // A clipboard that throws instead of rejecting (a denied permission in some browsers) fails
      // the same way.
      void Promise.resolve()
        .then(() => clipboard.writeText(codeBlockText(pre)))
        .then(
          () => show(COPIED_LABEL),
          () => show(COPY_FAILED_LABEL),
        )
    })
    wrap.append(button, status)
    added += 1
  }
  return added
}
