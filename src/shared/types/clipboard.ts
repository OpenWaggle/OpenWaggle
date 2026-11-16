/**
 * An image the system clipboard holds, as the PNG bytes an attachment can carry. The desktop
 * shell reads it natively (ADR 0068): a Windows CF_DIB bitmap from the Snipping Tool is not
 * reliably exposed to the renderer as a file, so paste cannot depend on the paste event alone.
 */
export interface ClipboardImageBytes {
  readonly bytes: Uint8Array
  readonly mimeType: 'image/png'
}
