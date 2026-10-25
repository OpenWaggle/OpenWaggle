import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Hero from '../Hero.astro';

const STAGE_BADGE = /<span\b[^>]*\bdata-release-stage\b[^>]*>([^<]*)<\/span>/u;

function stageBadge(html: string): string | undefined {
  return html.match(STAGE_BADGE)?.[1]?.trim();
}

describe('landing hero release stage', () => {
  it('labels the stage of the released app version instead of a hard-coded one', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8'));
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero);
    const expected = /-rc\./u.test(version) ? 'Release candidate' : /-beta\./u.test(version) ? 'Beta' : undefined;
    expect(stageBadge(html)).toBe(expected);
    expect(html).not.toMatch(/\bALPHA\b/u);
  });

  it.each([
    ['1.0.0-beta.25', 'Beta'],
    ['1.0.0-rc.1', 'Release candidate'],
  ])('shows %s as %s', async (version, label) => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero, { props: { version } });
    expect(stageBadge(html)).toBe(label);
  });

  it('drops the badge once the version is Stable', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Hero, { props: { version: '1.0.0' } });
    expect(stageBadge(html)).toBeUndefined();
    expect(html).toContain('Desktop coding agent');
  });
});
