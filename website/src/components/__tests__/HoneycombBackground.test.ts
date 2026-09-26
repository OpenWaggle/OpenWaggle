import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import HoneycombBackground from '../HoneycombBackground.astro';

describe('honeycomb background', () => {
  it('lights only the shared grid edges, without separate flashing cell fills', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(HoneycombBackground);
    expect(html).toContain('mask="url(#honeycomb-lines)"');
    expect(html).toContain('fill="url(#honeycomb-tile)"');
    expect(html.match(/<ellipse\b/g)).toHaveLength(1);
    expect(html).not.toContain('<polygon');
  });

  it('tiles cells edge-to-edge, with six neighbours per cell', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(HoneycombBackground);
    const tile = html.match(/<pattern id="honeycomb-tile" width="([\d.]+)" height="([\d.]+)"[^>]*>([\s\S]*?)<\/pattern>/);
    if (!tile) throw new Error('Missing honeycomb tile');
    const width = Number(tile[1]);
    const height = Number(tile[2]);
    const path = tile[3]?.match(/\bd="([^"]+)"/)?.[1];
    if (!path) throw new Error('Missing honeycomb outline');
    const cells = path.split('M').filter(Boolean).map((cell) => {
      const numbers = cell.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      expect(numbers).toHaveLength(12);
      return Array.from({ length: 6 }, (_, i) => [numbers[i * 2] ?? 0, numbers[i * 2 + 1] ?? 0]);
    });
    const pointKey = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
    const reference = new Set(cells[0]?.map(([x = 0, y = 0]) => pointKey(x, y)));
    expect(reference.size).toBe(6);
    const neighbours = new Set<string>();
    for (const column of [-1, 0, 1]) {
      for (const row of [-1, 0, 1]) {
        for (const cell of cells) {
          const points = cell.map(([x = 0, y = 0]) => pointKey(x + column * width, y + row * height));
          if (points.filter((point) => reference.has(point)).length === 2) {
            neighbours.add(points.sort().join(';'));
          }
        }
      }
    }
    expect(neighbours.size).toBe(6);
  });
});
