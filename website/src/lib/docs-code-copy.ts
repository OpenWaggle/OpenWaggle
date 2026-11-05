// Adds a Copy button to every docs code block, so a reader can paste an install or setup command
// without selecting it by hand. Without JavaScript or the Clipboard API, blocks stay plain text.
// Diagrams rendered from ```mermaid are not <pre> blocks, so they get no button.

export const CODE_COPY_CLASS = 'docs-code-copy';
const COPIED_LABEL = 'Copied';
const COPY_FAILED_LABEL = 'Copy failed';
const COPY_LABEL = 'Copy';
const RESET_AFTER_MS = 2000;

/** The text a Copy button puts on the clipboard: the block's code without the trailing newline. */
export function codeBlockText(pre: HTMLPreElement) {
  return (pre.querySelector('code') ?? pre).textContent?.replace(/\n+$/u, '') ?? '';
}

/**
 * Adds a Copy button to each `pre` under `root` and returns how many it added. Adds none when the
 * Clipboard API is unavailable (an insecure origin, or an old browser). The button shows Copied or
 * Copy failed for two seconds, and a polite live region beside it says the same to screen readers,
 * because the button's accessible name stays "Copy code to clipboard".
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
    const status = pre.ownerDocument.createElement('span');
    status.className = `${CODE_COPY_CLASS}-status`;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let reset: ReturnType<typeof setTimeout> | undefined;
    const show = (label: string) => {
      button.textContent = label;
      status.textContent = label;
      clearTimeout(reset);
      reset = setTimeout(() => {
        button.textContent = COPY_LABEL;
        status.textContent = '';
      }, RESET_AFTER_MS);
    };
    button.addEventListener('click', () => {
      // A clipboard that throws instead of rejecting (a denied permission in some browsers) fails
      // the same way.
      void Promise.resolve()
        .then(() => clipboard.writeText(codeBlockText(pre)))
        .then(
          () => show(COPIED_LABEL),
          () => show(COPY_FAILED_LABEL),
        );
    });
    wrap.append(button, status);
    added += 1;
  }
  return added;
}
