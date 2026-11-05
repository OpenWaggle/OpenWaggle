// Adds a Copy button to every docs code block, so a reader can paste an install or setup command
// without selecting it by hand. Without JavaScript or the Clipboard API, blocks stay plain text.
// Diagrams rendered from ```mermaid are not <pre> blocks, so they get no button.

export const CODE_COPY_CLASS = 'docs-code-copy';
const COPIED_LABEL = 'Copied';
const COPY_LABEL = 'Copy';
const RESET_AFTER_MS = 2000;

/** The text a Copy button puts on the clipboard: the block's code without the trailing newline. */
export function codeBlockText(pre: HTMLPreElement) {
  return (pre.querySelector('code') ?? pre).textContent?.replace(/\n+$/u, '') ?? '';
}

/**
 * Adds a Copy button to each `pre` under `root` and returns how many it added. Adds none when the
 * Clipboard API is unavailable (an insecure origin, or an old browser).
 */
export function enhanceDocsCodeCopy(
  root: Document | HTMLElement,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard,
) {
  if (!clipboard) return 0;
  let added = 0;
  for (const pre of root.querySelectorAll<HTMLPreElement>('.prose-docs pre')) {
    if (pre.parentElement?.classList.contains(`${CODE_COPY_CLASS}-wrap`)) continue;
    const wrap = pre.ownerDocument.createElement('div');
    wrap.className = `${CODE_COPY_CLASS}-wrap`;
    pre.replaceWith(wrap);
    wrap.append(pre);
    const button = pre.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = CODE_COPY_CLASS;
    button.textContent = COPY_LABEL;
    button.setAttribute('aria-label', 'Copy code to clipboard');
    let reset: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener('click', () => {
      void clipboard.writeText(codeBlockText(pre)).then(() => {
        button.textContent = COPIED_LABEL;
        clearTimeout(reset);
        reset = setTimeout(() => {
          button.textContent = COPY_LABEL;
        }, RESET_AFTER_MS);
      });
    });
    wrap.append(button);
    added += 1;
  }
  return added;
}
