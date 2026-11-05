// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CODE_COPY_CLASS, enhanceDocsCodeCopy } from '../docs-code-copy';

const INSTALL = 'curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh | bash';

beforeEach(() => {
  document.body.innerHTML = `<article class="prose-docs"><pre><code>${INSTALL}\n</code></pre><p>Text</p><pre><code>openwaggle --help</code></pre></article>`;
});

describe('docs code copy buttons', () => {
  it('adds one Copy button per code block and copies the command without its trailing newline', async () => {
    const writeText = vi.fn(async () => undefined);
    expect(enhanceDocsCodeCopy(document, { writeText })).toBe(2);
    const button = document.querySelector<HTMLButtonElement>(`.${CODE_COPY_CLASS}`);
    button?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(INSTALL);
    await Promise.resolve();
    expect(button?.textContent).toBe('Copied');
  });

  it('does not add a second button when it runs again', () => {
    const clipboard = { writeText: async () => undefined };
    enhanceDocsCodeCopy(document, clipboard);
    expect(enhanceDocsCodeCopy(document, clipboard)).toBe(0);
    expect(document.querySelectorAll(`.${CODE_COPY_CLASS}`)).toHaveLength(2);
  });

  it('leaves blocks plain without the Clipboard API', () => {
    expect(enhanceDocsCodeCopy(document, undefined)).toBe(0);
    expect(document.querySelector(`.${CODE_COPY_CLASS}`)).toBeNull();
  });
});
