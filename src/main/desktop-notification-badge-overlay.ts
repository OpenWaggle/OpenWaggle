/** The Windows taskbar overlay's side, in pixels. */
export const BADGE_OVERLAY_SIZE = 16
const BYTES_PER_PIXEL = 4
const FULL_ALPHA = 255
const HALF_PIXEL = 0.5
/** Half a pixel of anti-aliasing at the dot's edge. */
const EDGE_SOFTNESS = HALF_PIXEL
const DOT_INSET = 1
/** #E5484D, the error red, as blue, green and red. */
const DOT_BLUE = 0x4d
const DOT_GREEN = 0x48
const DOT_RED = 0xe5
const GREEN_OFFSET = 1
const RED_OFFSET = 2
const ALPHA_OFFSET = 3

function premultiplied(channel: number, alpha: number) {
  return Math.round((channel * alpha) / FULL_ALPHA)
}

/**
 * A red dot, as premultiplied BGRA pixels, for the Windows taskbar overlay: Windows has no Dock
 * count, so the Notification badge is a dot there (ADR 0062).
 */
export function badgeOverlayPixels() {
  const pixels = Buffer.alloc(BADGE_OVERLAY_SIZE * BADGE_OVERLAY_SIZE * BYTES_PER_PIXEL)
  const centre = (BADGE_OVERLAY_SIZE - 1) * HALF_PIXEL
  const radius = BADGE_OVERLAY_SIZE * HALF_PIXEL - DOT_INSET
  for (let y = 0; y < BADGE_OVERLAY_SIZE; y += 1) {
    for (let x = 0; x < BADGE_OVERLAY_SIZE; x += 1) {
      const distance = Math.hypot(x - centre, y - centre)
      const coverage = Math.max(0, Math.min(1, radius + EDGE_SOFTNESS - distance))
      const alpha = Math.round(coverage * FULL_ALPHA)
      const offset = (y * BADGE_OVERLAY_SIZE + x) * BYTES_PER_PIXEL
      pixels[offset] = premultiplied(DOT_BLUE, alpha)
      pixels[offset + GREEN_OFFSET] = premultiplied(DOT_GREEN, alpha)
      pixels[offset + RED_OFFSET] = premultiplied(DOT_RED, alpha)
      pixels[offset + ALPHA_OFFSET] = alpha
    }
  }
  return pixels
}
