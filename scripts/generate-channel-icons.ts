import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import type { BuildChannel } from '../src/shared/types/build-identity'

/**
 * Regenerates the per-channel Build identity icons (docs/adr/0032) from the
 * canonical build/icon.png. Stable keeps the hand-authored icon; each non-stable
 * channel keeps the full-colour brand mark and adds a small, rounded, floating
 * pill near the bottom so builds are distinguishable at a glance without
 * dominating the artwork. Icons are committed, so this runs on a developer
 * machine, never in CI. Run: `tsx scripts/generate-channel-icons.ts`.
 */

const PILL_HEIGHT_RATIO = 0.135
const PILL_BOTTOM_MARGIN_RATIO = 0.075
const PILL_FONT_RATIO = 0.5
const PILL_PAD_X_RATIO = 0.55
const PILL_CHAR_WIDTH_RATIO = 0.62
const PILL_LETTER_SPACING_RATIO = 0.12
const PILL_STROKE_RATIO = 0.03
const PILL_OPACITY = 0.92
const HALF = 2

const CHANNELS: Record<Exclude<BuildChannel, 'stable'>, { color: string; label: string }> = {
  alpha: { color: '#B4713C', label: 'ALPHA' },
  beta: { color: '#6E56C8', label: 'BETA' },
  rc: { color: '#2C8AA0', label: 'RC' },
  dev: { color: '#5B6675', label: 'DEV' },
}

function pillSvg(width: number, height: number, color: string, label: string) {
  const pillHeight = Math.round(height * PILL_HEIGHT_RATIO)
  const fontSize = Math.round(pillHeight * PILL_FONT_RATIO)
  const letterSpacing = fontSize * PILL_LETTER_SPACING_RATIO
  const padX = pillHeight * PILL_PAD_X_RATIO
  const textWidth =
    label.length * fontSize * PILL_CHAR_WIDTH_RATIO + (label.length - 1) * letterSpacing
  const pillWidth = Math.round(textWidth + padX + padX)
  const pillX = Math.round((width - pillWidth) / HALF)
  const pillY = Math.round(height - height * PILL_BOTTOM_MARGIN_RATIO - pillHeight)
  const radius = pillHeight / HALF
  const strokeWidth = pillHeight * PILL_STROKE_RATIO
  const textY = pillY + pillHeight / HALF
  return [
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" ` +
      `rx="${radius}" ry="${radius}" fill="${color}" fill-opacity="${PILL_OPACITY}" ` +
      `stroke="#ffffff" stroke-opacity="0.16" stroke-width="${strokeWidth}"/>`,
    `<text x="${width / HALF}" y="${textY}" dominant-baseline="central" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" ` +
      `letter-spacing="${letterSpacing}" fill="#ffffff" fill-opacity="0.96">${label}</text>`,
    `</svg>`,
  ].join('')
}

async function generate(buildDir: string): Promise<void> {
  const source = path.join(buildDir, 'icon.png')
  const { width, height } = await sharp(source).metadata()
  if (!width || !height) throw new Error(`Could not read dimensions of ${source}`)

  for (const [channel, { color, label }] of Object.entries(CHANNELS)) {
    const pill = Buffer.from(pillSvg(width, height, color, label))
    const out = path.join(buildDir, `icon-${channel}.png`)
    await sharp(source).composite([{ input: pill, top: 0, left: 0 }]).png().toFile(out)
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
