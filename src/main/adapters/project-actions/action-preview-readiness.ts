const PROBE_TIMEOUT_MS = 1_000
const PROBE_INTERVAL_MS = 750

export async function probeActionPreview(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    })
    await response.body?.cancel()
    // An HTTP response (including 404/405) proves that the server is accepting requests.
    return true
  } catch {
    return false
  }
}

export class ActionPreviewReadiness {
  private readonly pending = new Map<
    string,
    { readonly url: string; readonly controller: AbortController }
  >()
  constructor(private readonly probe = probeActionPreview) {}

  watch(id: string, url: string | null, onReady: (url: string) => void) {
    if (!url || this.pending.get(id)?.url === url) return
    this.cancel(id)
    const controller = new AbortController()
    this.pending.set(id, { url, controller })
    const attempt = async () => {
      const ready = await this.probe(url, controller.signal).catch(() => false)
      if (controller.signal.aborted) return
      if (ready) {
        onReady(url)
        return
      }
      const cancel = () => clearTimeout(timer)
      const timer = setTimeout(() => {
        controller.signal.removeEventListener('abort', cancel)
        void attempt()
      }, PROBE_INTERVAL_MS)
      timer.unref()
      controller.signal.addEventListener('abort', cancel, { once: true })
    }
    void attempt()
  }

  cancel(id: string) {
    this.pending.get(id)?.controller.abort()
    this.pending.delete(id)
  }
}
