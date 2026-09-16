import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import type { BuildChannel } from '../src/shared/types/build-identity'

/**
 * Regenerates the per-channel Build identity icons (docs/adr/0032) from the
 * canonical build/icon.png. Stable keeps the hand-authored icon; each non-stable
 * channel keeps the full-colour brand mark and adds a labelled bottom ribbon so
 * builds are distinguishable at a glance without muddying the artwork. Icons are
 * committed, so this runs on a developer machine, never in CI.
 * Run: `tsx scripts/generate-channel-icons.ts`.
 */

const RIBBON_HEIGHT_RATIO = 0.26
const RIBBON_TOP_EDGE_PX = 3
const RIBBON_FONT_RATIO = 0.46
const RIBBON_LETTER_SPACING_RATIO = 0.14
const RIBBON_OPACITY = 0.96
const HALF = 2

const CHANNELS: Record<Exclude<BuildChannel, 'stable'>, { color: string; label: string }> = {
  alpha: { color: '#B45309', label: 'ALPHA' },
  beta: { color: '#6D28D9', label: 'BETA' },
  rc: { color: '#0E7490', label: 'RC' },
  dev: { color: '#475569', label: 'DEV' },
}

function ribbonSvg(width: number, height: number, color: string, label: string) {
  const bandHeight = Math.round(height * RIBBON_HEIGHT_RATIO)
  const bandY = height - bandHeight
  const fontSize = Math.round(bandHeight * RIBBON_FONT_RATIO)
  const letterSpacing = Math.round(fontSize * RIBBON_LETTER_SPACING_RATIO)
  const textY = bandY + bandHeight / HALF
  return [
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="0" y="${bandY}" width="${width}" height="${bandHeight}" fill="${color}" fill-opacity="${RIBBON_OPACITY}"/>`,
    `<rect x="0" y="${bandY}" width="${width}" height="${RIBBON_TOP_EDGE_PX}" fill="#ffffff" fill-opacity="0.28"/>`,
    `<text x="${width / HALF}" y="${textY}" dominant-baseline="central" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="700" ` +
      `letter-spacing="${letterSpacing}" fill="#ffffff">${label}</text>`,
    `</svg>`,
  ].join('')
}

async function generate(buildDir: string): Promise<void> {
  const source = path.join(buildDir, 'icon.png')
  const { width, height } = await sharp(source).metadata()
  if (!width || !height) throw new Error(`Could not read dimensions of ${source}`)

  for (const [channel, { color, label }] of Object.entries(CHANNELS)) {
    const ribbon = Buffer.from(ribbonSvg(width, height, color, label))
    const out = path.join(buildDir, `icon-${channel}.png`)
    await sharp(source).composite([{ input: ribbon, top: 0, left: 0 }]).png().toFile(out)
    console.log(`wrote ${out}`)
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectInvocation) {
  const buildDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build')
  void generate(buildDir).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

export { generate }
