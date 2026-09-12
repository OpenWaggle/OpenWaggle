import { resolveBrowserProfiles } from '@shared/types/browser-profile'
import { Globe2, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import type { BrowserPreviewPanelCallbacks, BrowserPreviewTab } from '../browser-preview-model'
import { normalizeBrowserPreviewUrl } from '../lib/browser-preview-url'
import { BrowserPreviewLauncherDestinations } from './BrowserPreviewLauncherDestinations'

interface BrowserPreviewLauncherProps
  extends Pick<BrowserPreviewPanelCallbacks, 'onError' | 'onMaterialize'> {
  readonly tab: BrowserPreviewTab
}

export function BrowserPreviewLauncher({
  onError,
  onMaterialize,
  tab,
}: BrowserPreviewLauncherProps) {
  const configuredProfiles = usePreferencesStore((state) => state.settings.browserProfiles)
  const profiles = useMemo(() => resolveBrowserProfiles(configuredProfiles), [configuredProfiles])
  const [address, setAddress] = useState('')
  const [profileId, setProfileId] = useState(tab.profileId)
  const addressRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => addressRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    if (profiles.some((profile) => profile.id === profileId)) return
    const fallback = profiles[0]
    if (fallback !== undefined) setProfileId(fallback.id)
  }, [profileId, profiles])

  const open = (rawUrl: string) => {
    const url = normalizeBrowserPreviewUrl(rawUrl)
    if (url === null) {
      onError('Enter a valid http or https address.')
      addressRef.current?.focus()
      addressRef.current?.select()
      return
    }
    onMaterialize(url, profileId)
  }
  return (
    <section
      className="flex size-full min-h-0 flex-col bg-bg"
      aria-label="Browser launcher"
      data-browser-preview-launcher
    >
      <form
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2"
        onSubmit={(event) => {
          event.preventDefault()
          open(address)
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Globe2 className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-text-muted" />
          <input
            ref={addressRef}
            aria-label="Preview address"
            value={address}
            placeholder="localhost:3000 or https://…"
            spellCheck={false}
            className="h-7 w-full rounded border border-border bg-bg-secondary pr-2 pl-7 text-xs text-text-secondary outline-none placeholder:text-text-muted focus:border-accent/60"
            onChange={(event) => setAddress(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Open
        </Button>
      </form>

      <div className="flex h-8 shrink-0 items-center justify-end border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1.5 text-text-tertiary">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          <Select
            aria-label="Browser profile"
            selectSize="xs"
            value={profileId}
            onChange={(event) => setProfileId(event.currentTarget.value)}
            className="max-w-36"
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.kind === 'incognito' ? ' (Incognito)' : ''}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <BrowserPreviewLauncherDestinations ownerKey={tab.ownerKey} tabId={tab.id} onSelect={open} />
    </section>
  )
}
