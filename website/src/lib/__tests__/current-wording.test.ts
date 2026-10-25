import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Website pages, components, and public text outside the bundled docs (website/src/content/docs),
// which ship inside the app and change only with their own review.
const WEBSITE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCANNED_DIRECTORIES = ['src/components', 'src/layouts', 'src/pages', 'src/data', 'src/lib', 'public'];
const TEXT_FILE = /\.(?:astro|ts|mdx?|txt|json|webmanifest|svg|html)$/u;
const STALE_WORDING = [/\bunsigned\b/iu, /\bsessions cli\b/iu, /\bopenwaggle sessions\b/iu];
// A hard-coded release stage goes stale at the next promotion; the hero derives it instead.
const HARD_CODED_STAGE = /\b(?:alpha|beta|release candidate)\b/iu;

function websiteFiles() {
  return SCANNED_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(WEBSITE_ROOT, directory), { recursive: true, encoding: 'utf8' })
      .filter((file) => TEXT_FILE.test(file) && !file.includes('__tests__'))
      .map((file) => join(directory, file)),
  );
}

describe('website wording outside the bundled docs', () => {
  it('does not call the app unsigned or refer to the retired Sessions CLI', () => {
    const offenders = websiteFiles().flatMap((file) => {
      const text = readFileSync(join(WEBSITE_ROOT, file), 'utf8');
      return STALE_WORDING.filter((pattern) => pattern.test(text)).map((pattern) => `${file}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it('does not hard-code a release stage in a page or component', () => {
    const offenders = websiteFiles()
      .filter((file) => file.endsWith('.astro'))
      .filter((file) => HARD_CODED_STAGE.test(readFileSync(join(WEBSITE_ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
