import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEBSITE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCREENSHOT_DIRECTORY = join(WEBSITE_ROOT, 'public', 'screenshots');
const SOURCE_FILE = /\.(?:astro|ts|mdx?)$/u;
const SCREENSHOT_REFERENCE = /\/screenshots\/([\w.-]+\.png)/gu;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\/screenshots\/([\w.-]+\.png)\)\n\n(_[^\n]+_)?/gu;
const DEMO_VIEW = /image: '\/screenshots\/([\w.-]+\.png)',\s*alt: '([^']+)'/gu;
// The Hive's groups are named for who acts next (ADR 0059, #380); these group names were retired.
const RETIRED_HIVE_GROUPS = /\b(?:needs attention|active|done)\b/iu;
const CURRENT_HIVE_GROUPS = ['Needs you', 'Waiting for', 'Working', 'Closed'];

function sourceFiles() {
  return readdirSync(join(WEBSITE_ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((file) => SOURCE_FILE.test(file) && !file.includes('__tests__'))
    .map((file) => join(WEBSITE_ROOT, 'src', file));
}

function screenshotFiles() {
  return readdirSync(SCREENSHOT_DIRECTORY).filter((file) => file.endsWith('.png'));
}

/** Every website screenshot with the alt text and caption the page gives it. */
function screenshotUses() {
  return sourceFiles().flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const images = [...text.matchAll(MARKDOWN_IMAGE)].map(([, alt = '', image = '', caption = '']) => ({
      file,
      image,
      alt,
      caption,
    }));
    const views = [...text.matchAll(DEMO_VIEW)].map(([, image = '', alt = '']) => ({ file, image, alt, caption: '' }));
    return [...images, ...views];
  });
}

describe('website screenshots', () => {
  it('references every screenshot it ships, and ships every screenshot it references', () => {
    const referenced = new Set(
      sourceFiles().flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(SCREENSHOT_REFERENCE)].map(([, image = '']) => image),
      ),
    );
    const shipped = new Set(screenshotFiles());
    expect([...shipped].filter((image) => !referenced.has(image))).toEqual([]);
    expect([...referenced].filter((image) => !shipped.has(image))).toEqual([]);
  });

  it('describes every screenshot with alt text', () => {
    const uses = screenshotUses();
    expect(new Set(uses.map(({ image }) => image))).toEqual(new Set(screenshotFiles()));
    expect(uses.filter(({ alt }) => alt.trim().length === 0)).toEqual([]);
  });

  it('names the Hive groups by who acts next in alt text and captions', () => {
    const hiveUses = screenshotUses().filter(({ image }) => image.startsWith('hive-'));
    expect(hiveUses.length).toBeGreaterThan(0);
    expect(hiveUses.filter(({ alt, caption }) => RETIRED_HIVE_GROUPS.test(`${alt} ${caption}`))).toEqual([]);
    const grouped = hiveUses.find(({ image }) => image === 'hive-next-actor.png');
    for (const group of CURRENT_HIVE_GROUPS) {
      expect(`${grouped?.alt ?? ''} ${grouped?.caption ?? ''}`).toContain(group);
    }
  });
});
