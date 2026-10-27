import openwaggleLockup from '@/assets/openwaggle-lockup.png'

/**
 * The static frame the window shows while the Session Host starts (maintainer decision 3): the
 * sidebar frame, the header, an empty chat and a disabled composer, in the last known
 * appearance. It holds no spinner and no made-up data, so nothing in it moves or misleads.
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
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
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
    </main>
  )
}
