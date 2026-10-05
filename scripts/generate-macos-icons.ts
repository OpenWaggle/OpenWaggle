import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import type { BuildChannel } from '../src/shared/types/build-identity'
import { MAC_DEV_DOCK_ICON, resolveMacIconPath } from './build-identity'
import { CHANNEL_BADGES, channelPillSvg } from './generate-channel-icons'

/**
 * Builds the macOS app icons from the canonical logo mark (build/branding/openwaggle-logo-mark.svg)
 * without changing the mark itself. macOS 11 and later draw every app icon on the same rounded
 * square ("squircle") grid, and macOS 26 places an icon that does not fill that shape on a grey
 * tile of its own. The free-form hexagon therefore looked small and off-grid in the Dock. Each icon
 * here sits the unchanged mark on a full-bleed graphite tile drawn on Apple's 1024 px icon grid:
 * an 824 px continuous-corner square centred on the canvas, with Apple's drop shadow in the margin.
 *
 * Icons are committed, so this runs on a macOS developer machine (it needs `iconutil`), never in CI.
 * Run: `tsx scripts/generate-macos-icons.ts`.
 */

const CANVAS = 1024
const TILE = 824
const TILE_ORIGIN = (CANVAS - TILE) / 2
const TILE_CORNER_RADIUS = 185.4
// The mark's viewBox is 512 units; its hexagon spans y 32..480. At this scale the hexagon is
// about 72 percent of the tile's height, the optical weight of Apple's own glyph-on-tile icons.
const MARK_VIEWBOX = 512
const MARK_SCALE = 1.32
const MARK_SIZE = MARK_VIEWBOX * MARK_SCALE
const MARK_ORIGIN = (CANVAS - MARK_SIZE) / 2
const HALF = 2
const PATH_PRECISION = 3
// Render the SVG at 1 px per unit; the canvas is already the largest icon size.
const SVG_DENSITY = 72

type Point = readonly [alongEdge: number, intoSquare: number]

/**
 * One continuous corner, walked from the top edge round to the right edge: a line to where the
 * curve starts, then curves (three points) joined by short lines (one point), in units of r.
 */
const CONTINUOUS_CORNER: readonly (readonly Point[])[] = [
  [[1.52866483, 0]],
  [
    [1.08849323, 0],
    [0.86840689, 0],
    [0.66993427, 0.065496],
  ],
  [[0.63149399, 0.074911]],
  [
    [0.37282392, 0.16905899],
    [0.16905899, 0.37282392],
    [0.074911, 0.63149399],
  ],
  [[0.065496, 0.66993427]],
  [
    [0, 0.86840689],
    [0, 1.08849323],
    [0, 1.52866483],
  ],
]

// Channel badges sit inside the tile, clear of its bottom edge.
const BADGE_HEIGHT = 104
const BADGE_BOTTOM_INSET = 46

/** `iconutil` names and pixel sizes of a complete macOS iconset. */
const ICONSET: readonly (readonly [name: string, size: number])[] = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

/**
 * Apple's continuous ("squircle") corner, as UIKit and the macOS icon template draw it. Each
 * corner of radius `r` is three cubic curves joined by short lines, so the curvature eases into
 * the straight edges; a circular arc meets them abruptly and reads as a generic rounded square.
 */
export function continuousSquarePath(origin: number, size: number, r: number) {
  const min = origin
  const max = origin + size
  // Rotates a corner offset (along the edge, into the square) onto each of the four corners.
  const corners = [
    ([u, v]: Point) => [max - u * r, min + v * r],
    ([u, v]: Point) => [max - v * r, max - u * r],
    ([u, v]: Point) => [min + u * r, max - v * r],
    ([u, v]: Point) => [min + v * r, min + u * r],
  ] as const
  const commands: string[] = []
  for (const [index, place] of corners.entries()) {
    for (const [step, points] of CONTINUOUS_CORNER.entries()) {
      const command = points.length > 1 ? 'C' : index === 0 && step === 0 ? 'M' : 'L'
      const coordinates = points.map((point) =>
        place(point)
          .map((value) => Number(value.toFixed(PATH_PRECISION)))
          .join(' '),
      )
      commands.push(`${command} ${coordinates.join(' ')}`)
    }
  }
  return [...commands, 'Z'].join(' ')
}

/** The mark's own SVG, nested unchanged; its element ids do not collide with the tile's. */
function nestedMark(markSvg: string) {
  // Inherited presentation attributes on the root, such as fill="none" for the stroke-only
  // antennae, must carry over, or those paths fill black.
  const root = /^[\s\S]*?<svg([^>]*)>/.exec(markSvg)?.[1] ?? ''
  const rootPresentation = [...root.matchAll(/\s(fill|stroke)="([^"]*)"/g)]
    .map(([, name, value]) => `${name}="${value}"`)
    .join(' ')
  const body = markSvg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title[\s\S]*?<\/title>/, '')
    .replace(/<desc[\s\S]*?<\/desc>/, '')
  return (
    `<svg x="${MARK_ORIGIN}" y="${MARK_ORIGIN}" width="${MARK_SIZE}" height="${MARK_SIZE}" ` +
    `viewBox="0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}" ${rootPresentation} overflow="visible">${body}</svg>`
  )
}

export function macosIconSvg(markSvg: string) {
  const tile = continuousSquarePath(TILE_ORIGIN, TILE, TILE_CORNER_RADIUS)
  return [
    `<svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">`,
    '<defs>',
    // Apple's icon template shadow: soft, below the tile, inside the canvas margin.
    '<filter id="tileShadow" x="-20%" y="-20%" width="140%" height="140%">',
    '<feGaussianBlur in="SourceAlpha" stdDeviation="10"/>',
    '<feOffset dy="10" result="blur"/>',
    '<feFlood flood-color="#000000" flood-opacity="0.3"/>',
    '<feComposite in2="blur" operator="in"/>',
    '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>',
    '</filter>',
    '<filter id="markShadow" x="-20%" y="-20%" width="140%" height="140%">',
    '<feGaussianBlur in="SourceAlpha" stdDeviation="16"/>',
    '<feOffset dy="14" result="blur"/>',
    '<feFlood flood-color="#000000" flood-opacity="0.45"/>',
    '<feComposite in2="blur" operator="in"/>',
    '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>',
    '</filter>',
    `<linearGradient id="tileFill" x1="0" y1="${TILE_ORIGIN}" x2="0" y2="${TILE_ORIGIN + TILE}" gradientUnits="userSpaceOnUse">`,
    '<stop offset="0" stop-color="#30353f"/>',
    '<stop offset="0.55" stop-color="#1b1e24"/>',
    '<stop offset="1" stop-color="#101216"/>',
    '</linearGradient>',
    // A warm glow behind the bee ties the graphite tile to the amber brand colour.
    '<radialGradient id="tileGlow" cx="512" cy="470" r="400" gradientUnits="userSpaceOnUse">',
    '<stop offset="0" stop-color="#f7be4e" stop-opacity="0.22"/>',
    '<stop offset="0.6" stop-color="#f7be4e" stop-opacity="0.06"/>',
    '<stop offset="1" stop-color="#f7be4e" stop-opacity="0"/>',
    '</radialGradient>',
    `<linearGradient id="tileSheen" x1="0" y1="${TILE_ORIGIN}" x2="0" y2="${TILE_ORIGIN + TILE / HALF}" gradientUnits="userSpaceOnUse">`,
    '<stop offset="0" stop-color="#ffffff" stop-opacity="0.08"/>',
    '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>',
    '</linearGradient>',
    `<clipPath id="tileClip"><path d="${tile}"/></clipPath>`,
    '</defs>',
    `<path d="${tile}" fill="url(#tileFill)" filter="url(#tileShadow)"/>`,
    `<path d="${tile}" fill="url(#tileGlow)"/>`,
    `<path d="${tile}" fill="url(#tileSheen)"/>`,
    // A hairline inside the edge keeps the dark tile distinct on a dark Dock or desktop.
    `<path d="${tile}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="4" clip-path="url(#tileClip)"/>`,
    `<g filter="url(#markShadow)">${nestedMark(markSvg)}</g>`,
    '</svg>',
  ].join('')
}

async function renderIcon(markSvg: string, channel: BuildChannel) {
  const base = sharp(Buffer.from(macosIconSvg(markSvg)), { density: SVG_DENSITY }).resize(CANVAS, CANVAS)
  if (channel === 'stable') return base.png().toBuffer()
  const badge = CHANNEL_BADGES[channel]
  const pill = channelPillSvg({
    width: CANVAS,
    height: CANVAS,
    pillHeight: BADGE_HEIGHT,
    bottom: TILE_ORIGIN + TILE - BADGE_BOTTOM_INSET,
    ...badge,
  })
  return base
    .composite([{ input: Buffer.from(pill), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

async function writeIcns(icon: Buffer, output: string) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'openwaggle-iconset-'))
  const iconset = path.join(workspace, 'icon.iconset')
  try {
    await mkdir(iconset)
    for (const [name, size] of ICONSET) {
      await sharp(icon)
        .resize(size, size, { kernel: 'lanczos3' })
        .png()
        .toFile(path.join(iconset, name))
    }
    await promisify(execFile)('iconutil', ['--convert', 'icns', '--output', output, iconset])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

// Every channel with a badge, plus Stable, so a new channel cannot be left without an icon.
const CHANNELS: readonly BuildChannel[] = [
  'stable',
  ...Object.keys(CHANNEL_BADGES).filter(
    (channel): channel is keyof typeof CHANNEL_BADGES => channel in CHANNEL_BADGES,
  ),
]

async function generate(buildDir: string) {
  const markSvg = await readFile(
    path.join(buildDir, 'branding', 'openwaggle-logo-mark.svg'),
    'utf8',
  )
  for (const channel of CHANNELS) {
    const icon = await renderIcon(markSvg, channel)
    const output = resolveMacIconPath(channel, buildDir)
    await writeIcns(icon, output)
    console.log(`wrote ${output}`)
    if (channel === 'dev') {
      // A dev build is not packaged, so it sets this PNG as its Dock icon at runtime.
      const dock = path.join(buildDir, MAC_DEV_DOCK_ICON)
      await sharp(icon).toFile(dock)
      console.log(`wrote ${dock}`)
    }
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

export { generate, renderIcon }
