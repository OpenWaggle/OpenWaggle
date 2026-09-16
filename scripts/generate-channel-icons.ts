import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import type { IconVariant } from './build-identity'

/**
 * Regenerates the per-channel Build identity icons (docs/adr/0032) from the
 * canonical build/icon.png. Stable keeps the hand-authored icon; each non-stable
 * channel gets a colour-washed variant so builds are distinguishable at a glance.
 * Run: `tsx scripts/generate-channel-icons.ts`.
 * ponytail: colour wash only; replace with badged art if the tint reads poorly.
 */

const RGBA_CHANNELS = 4

const TINTS: Record<Exclude<IconVariant, 'stable'>, { r: number; g: number; b: number }> = {
  alpha: { r: 255, g: 150, b: 40 },
  prerelease: { r: 150, g: 90, b: 230 },
  dev: { r: 90, g: 110, b: 130 },
}

async function generate(buildDir: string): Promise<void> {
  const source = path.join(buildDir, 'icon.png')
  const { width, height } = await sharp(source).metadata()
  if (!width || !height) throw new Error(`Could not read dimensions of ${source}`)

  for (const [variant, tint] of Object.entries(TINTS)) {
    const overlay = await sharp({
      create: { width, height, channels: RGBA_CHANNELS, background: { ...tint, alpha: 1 } },
    })
      .png()
      .toBuffer()
    const out = path.join(buildDir, `icon-${variant}.png`)
    await sharp(source).composite([{ input: overlay, blend: 'multiply' }]).png().toFile(out)
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
