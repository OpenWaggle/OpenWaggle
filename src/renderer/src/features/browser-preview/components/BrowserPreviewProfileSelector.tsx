import { resolveBrowserProfiles } from '@shared/types/browser-profile'
import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { Select } from '@/shared/ui/Select'
import type { BrowserPreviewPanelCallbacks, BrowserPreviewTab } from '../browser-preview-model'
import { clearBrowserPreviewExternalFallback } from '../lib/browser-preview-external-fallback'

interface BrowserPreviewProfileSelectorProps
  extends Pick<BrowserPreviewPanelCallbacks, 'onError' | 'onUpdate'> {
  readonly tab: BrowserPreviewTab
}

/** Changes storage identity only after disposing the profile-bound native view. */
export function BrowserPreviewProfileSelector({
  onError,
  onUpdate,
  tab,
}: BrowserPreviewProfileSelectorProps) {
  const configuredProfiles = usePreferencesStore((state) => state.settings.browserProfiles)
  const profiles = useMemo(() => resolveBrowserProfiles(configuredProfiles), [configuredProfiles])
  const [changing, setChanging] = useState(false)
  const knownProfile = profiles.some((profile) => profile.id === tab.profileId)

  const changeProfile = (profileId: string) => {
    if (changing || profileId === tab.profileId) return
    setChanging(true)
    void api
      .closeBrowserPreview(tab.id)
      .then(() => {
        clearBrowserPreviewExternalFallback(tab.id)
        onUpdate({
          profileId,
          loading: true,
          canGoBack: false,
          canGoForward: false,
          error: null,
        })
      })
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : 'Browser profile could not change.')
      })
      .finally(() => setChanging(false))
  }

  return (
    <label
      htmlFor={`browser-profile-${tab.id}`}
      className="flex min-w-0 items-center gap-1.5 text-text-tertiary"
    >
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Browser profile</span>
      <Select
        id={`browser-profile-${tab.id}`}
        aria-label="Browser profile"
        selectSize="xs"
        value={tab.profileId}
        disabled={changing}
        onChange={(event) => changeProfile(event.currentTarget.value)}
        className="max-w-32"
      >
        {!knownProfile ? <option value={tab.profileId}>Removed profile</option> : null}
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
            {profile.kind === 'incognito' ? ' (Incognito)' : ''}
          </option>
        ))}
      </Select>
    </label>
  )
}
