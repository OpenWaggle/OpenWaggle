import openwaggleLockup from '@/assets/openwaggle-lockup.png'
// Inline, like the page's own frame: it paints with the first frame, with no request to wait for.
import openwaggleMark from '@/assets/openwaggle-mark.png?inline'

/**
 * The static frame the window shows while the Session Host starts (maintainer decision 3): the
 * sidebar frame, the header, an empty chat and a disabled composer, in the last known
 * appearance. It holds no spinner and no made-up data, so nothing in it moves or misleads.
 *
 * `src/renderer/index.html` holds the same markup, so the window paints this frame before the
 * renderer's scripts run; a component test keeps the two identical. The empty chat shows the
 * welcome mark where the new-chat screen shows it: it is the largest image of the launch screen,
 * so the window's largest contentful paint is this frame's first paint, not the later shell's.
 * The mark is inlined and decoded with the frame, so that first paint already holds it, and the
 * new-chat screen shows the same decoded image.
 */
export function StartupSkeleton({ notice }: { readonly notice?: string }) {
  return (
    <main
      data-startup-skeleton=""
      aria-busy="true"
      aria-label="OpenWaggle is starting"
      className="flex size-full overflow-hidden bg-bg"
    >
      {/* The sidebar's width (SIDEBAR_LAYOUT.WIDTH_CLASS), so the frame does not jump. */}
      <div className="flex h-full w-79 shrink-0 flex-col border-r border-border bg-bg-secondary">
        {/* The sidebar's own brand area: drag region, then the 28px lockup. */}
        <div className="drag-region h-8 shrink-0" />
        <div className="drag-region flex shrink-0 items-center px-3.5 pt-2.5 pb-1.5">
          <img src={openwaggleLockup} alt="OpenWaggle" className="h-7 w-auto object-contain" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="drag-region h-12 shrink-0 border-b border-border bg-bg" />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6">
          {/* The new-chat screen's mark (WelcomeScreen), at its size. */}
          <img src={openwaggleMark} alt="" decoding="sync" className="size-20 object-contain" />
          {notice ? (
            <p role="status" className="text-sm text-text-secondary">
              {notice}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 px-5 pb-5">
          <div
            aria-hidden="true"
            className="mx-auto h-24 w-full max-w-3xl rounded-xl border border-border bg-bg-secondary opacity-60"
          />
        </div>
      </div>
      {/*
        Invisible text in the shell's faces. Laid out while the Host starts, it loads the fonts and
        their shaping caches, which the shell's first layout otherwise paid for (about 80 ms). Not
        in index.html: there it would delay the first paint by the same layout.
      */}
      <div aria-hidden="true" data-startup-font-warmup="" className="sr-only">
        <span className="text-sm">Aa</span>
        <span className="text-sm font-medium">Aa</span>
        <span className="text-sm font-semibold">Aa</span>
        <span className="font-mono text-xs">Aa</span>
      </div>
    </main>
  )
}
