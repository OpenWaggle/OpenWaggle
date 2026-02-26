import { usePreferences } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'

export function GeneralSection(): React.JSX.Element {
  const { settings, setBrowserHeadless } = usePreferences()

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] font-semibold text-text-primary">General</h2>

      {/* Browser */}
      <div className="rounded-lg border border-border bg-[#111418] p-5">
        <h3 className="text-sm font-medium text-text-secondary mb-3">Browser</h3>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-text-primary">Show browser window</span>
            <p className="text-[13px] text-text-tertiary mt-0.5">
              When enabled, browser tools open a visible Chromium window instead of running
              headless.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={!settings.browserHeadless}
              onChange={(e) => setBrowserHeadless(!e.target.checked)}
              className="sr-only peer"
              role="switch"
              aria-checked={!settings.browserHeadless}
              aria-label="Show browser window"
            />
            <div
              className={cn(
                'w-9 h-5 rounded-full transition-colors',
                'bg-bg-tertiary peer-checked:bg-accent',
                'after:content-[""] after:absolute after:top-0.5 after:left-[2px]',
                'after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all',
                'peer-checked:after:translate-x-full',
              )}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
