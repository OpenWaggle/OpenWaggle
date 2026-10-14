export const INLINE_VISUALIZATION_PROTOCOL = {
  SCHEME: 'openwaggle-visualization',
  FRAME_HOST_PREFIX: 'frame-',
  DOCUMENT_PATH: '/document',
  LUCIDE_PATH: '/lucide.js',
  BASE_STYLE_PATH: '/base.css',
} as const

export const MAX_INLINE_VISUALIZATION_PATH_LENGTH = 32_768
/**
 * Serialized UTF-8 bound for reported and restored visualization state. The frame runtime
 * (`host-runtime.js.raw`) cannot import this and repeats the value; keep them equal.
 */
export const MAX_INLINE_VISUALIZATION_STATE_BYTES = 16 * 1024
