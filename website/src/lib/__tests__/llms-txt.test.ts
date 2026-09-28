import { describe, expect, it } from 'vitest';
import { buildLlmsTxt } from '../llms-txt';

describe('llms.txt', () => {
  it('lists pages under their section with absolute URLs and descriptions', () => {
    const text = buildLlmsTxt([
      {
        title: 'Getting started',
        pages: [
          { title: 'Installation', path: '/docs/getting-started/installation/', description: 'How to install OpenWaggle.' },
          { title: 'No description', path: '/docs/x/' },
        ],
      },
    ]);
    expect(text.startsWith('# OpenWaggle\n\n> ')).toBe(true);
    expect(text).toContain('## Getting started\n\n- [Installation](https://openwaggle.ai/docs/getting-started/installation/): How to install OpenWaggle.');
    expect(text).toContain('- [No description](https://openwaggle.ai/docs/x/)\n');
  });
});
