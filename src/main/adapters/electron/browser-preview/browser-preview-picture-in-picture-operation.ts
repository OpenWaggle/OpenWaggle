const WINDOW_LOAD_TIMEOUT_MS = 3_000
const FRAME_DELIVERY_TIMEOUT_MS = 1_000

type PictureInPictureOperation = 'load' | 'frame-delivery'

export function buildBrowserPreviewPictureInPictureUrl(): string {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
    <meta name="color-scheme" content="dark">
    <style>
      html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111}
      body{display:grid;place-items:center}
      img{width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none}
    </style>
  </head>
  <body><img id="openwaggle-preview-frame" alt="Live browser preview"></body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export class BrowserPreviewPictureInPictureTimeoutError extends Error {
  constructor(operation: PictureInPictureOperation) {
    super(
      operation === 'load'
        ? 'Picture-in-picture viewer did not load before the timeout.'
        : 'Picture-in-picture frame delivery did not finish before the timeout.',
    )
    this.name = 'BrowserPreviewPictureInPictureTimeoutError'
  }
}

function cancellationError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Picture-in-picture operation was cancelled.')
}

function timeoutFor(operation: PictureInPictureOperation) {
  return operation === 'load' ? WINDOW_LOAD_TIMEOUT_MS : FRAME_DELIVERY_TIMEOUT_MS
}

export function boundedPictureInPictureOperation<A>(
  pending: PromiseLike<A>,
  signal: AbortSignal,
  operation: PictureInPictureOperation,
): Promise<A> {
  if (signal.aborted) return Promise.reject(cancellationError(signal))
  return new Promise<A>((resolve, reject) => {
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      settle()
    }
    const timeout = setTimeout(
      () => finish(() => reject(new BrowserPreviewPictureInPictureTimeoutError(operation))),
      timeoutFor(operation),
    )
    timeout.unref()
    const onAbort = () => finish(() => reject(cancellationError(signal)))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(pending).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}
