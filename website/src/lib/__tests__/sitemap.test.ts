import { describe, expect, it } from 'vitest';
import { isIndexablePage } from '../sitemap';

describe('sitemap filter', () => {
  it.each([
    ['https://openwaggle.ai/', true],
    ['https://openwaggle.ai/docs/getting-started/installation/', true],
    ['https://openwaggle.ai/docs/packages/overview/', true],
    ['https://openwaggle.ai/docs/packages/pi-waggle/0.1/', true],
    ['https://openwaggle.ai/docs/packages/pi-waggle/', false],
    ['https://openwaggle.ai/benchmarks/', false],
  ])('%s indexable: %s', (page, expected) => {
    expect(isIndexablePage(page)).toBe(expected);
  });
});
