const MAX_BROWSER_PREVIEW_ERROR_LENGTH = 1_024
const ASCII_CONTROL_END = 0x1f
const ASCII_DELETE = 0x7f

export function browserPreviewOwnerKey(ownerKey: string, previewId: string) {
  return `${ownerKey}\0${previewId}`
}

export function boundedBrowserPreviewOwnerError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Browser preview could not open.'
  let sanitized = ''
  for (const character of message) {
    const codePoint = character.codePointAt(0)
    sanitized +=
      codePoint !== undefined && (codePoint <= ASCII_CONTROL_END || codePoint === ASCII_DELETE)
        ? ' '
        : character
  }
  return (
    sanitized.trim().slice(0, MAX_BROWSER_PREVIEW_ERROR_LENGTH) || 'Browser preview could not open.'
  )
}
