// Pi's own prompt image defaults, as Pi's model configuration declares them.

/**
 * What Pi resizes a prompt image to when the selected model declares no limits of its own
 * (ADR 0068). OpenWaggle targets these numbers only for an image it had to decode itself, so the
 * result already fits and Pi passes it through; Pi stays the only implementation that normalizes
 * prompt images, and `MAX_BASE64_BYTES` is measured in base64 characters, the way Pi measures it.
 */
export const PI_PROMPT_IMAGE_DEFAULTS = {
  /** Longest edge Pi resizes to. */
  MAX_DIMENSION: 2_000,
  /** Largest base64 payload Pi delivers for one image. */
  MAX_BASE64_BYTES: 4_718_592,
  JPEG_QUALITY: 80,
} as const
