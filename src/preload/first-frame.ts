/**
 * Tells the main process when the page can be shown (ADR 0064): its document is parsed and every
 * stylesheet it links has applied, so the startup frame of `index.html` lays out styled. Electron
 * shows the window on `ready-to-show`, its first paint, which comes before the renderer's module
 * graph has loaded; Electrobun's `dom-ready` is the page's `load`, after the whole graph and every
 * image. The system webviews report no first paint, and a hidden window paints nothing, so the
 * page reports the moment it would.
 *
 * Runs from the preload, before the page's own scripts.
 */
export function reportFirstFrame(page: Document, report: () => void) {
  let reported = false
  const reportOnce = () => {
    if (reported) return
    reported = true
    // Lays the startup frame out before the window is shown.
    page.documentElement.getBoundingClientRect()
    report()
  }
  const whenStyled = () => {
    const pending = [...page.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(
      (link) => link.sheet === null,
    )
    if (pending.length === 0) {
      reportOnce()
      return
    }
    // A stylesheet that fails still lets the page show; the renderer reports its own failure.
    const settled = pending.map(
      (link) =>
        new Promise<void>((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true })
          link.addEventListener('error', () => resolve(), { once: true })
        }),
    )
    void Promise.all(settled).then(reportOnce)
  }
  if (page.readyState !== 'loading') {
    whenStyled()
    return
  }
  page.addEventListener(
    'readystatechange',
    () => {
      if (page.readyState !== 'loading') whenStyled()
    },
    { once: true },
  )
}
