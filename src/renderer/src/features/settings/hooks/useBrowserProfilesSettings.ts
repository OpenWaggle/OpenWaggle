import {
  BROWSER_PROFILE_LIMITS,
  type BrowserProfile,
  resolveBrowserProfiles,
} from '@shared/types/browser-profile'
import type { SubmitEvent } from 'react'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { usePreferencesStore } from '../state'

function newProfileId() {
  return `profile-${crypto.randomUUID()}`
}

function profileUpdateError(error: unknown) {
  return error instanceof Error ? error.message : 'Browser profiles could not update.'
}

export function useBrowserProfilesSettings() {
  const settings = usePreferencesStore((state) => state.settings)
  const setDefault = usePreferencesStore((state) => state.setBrowserDefaultProfileId)
  const setProfiles = usePreferencesStore((state) => state.setBrowserProfiles)
  const setAgentAccess = usePreferencesStore((state) => state.setEnableAgentBrowserAccess)
  const profiles = resolveBrowserProfiles(settings.browserProfiles)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [agentSaving, setAgentSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  function run(operation: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    void operation()
      .catch((error: unknown) => setMessage(profileUpdateError(error)))
      .finally(() => setBusy(false))
  }

  function addProfile(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || settings.browserProfiles.length >= BROWSER_PROFILE_LIMITS.USER_PROFILES) return
    run(async () => {
      await setProfiles([
        ...settings.browserProfiles,
        { id: newProfileId(), name: trimmed, kind: 'persistent' },
      ])
      setName('')
    })
  }

  function renameProfile(profile: BrowserProfile, nextName: string) {
    run(() =>
      setProfiles(
        settings.browserProfiles.map((candidate) =>
          candidate.id === profile.id ? { ...candidate, name: nextName } : candidate,
        ),
      ),
    )
  }

  async function removeProfile(profile: BrowserProfile) {
    const confirmed = await api.showConfirm(
      `Delete browser profile “${profile.name}”?`,
      'Its saved logins and site data will be cleared first.',
    )
    if (!confirmed) return
    run(async () => {
      await api.clearBrowserProfileData(profile.id)
      await setProfiles(settings.browserProfiles.filter((candidate) => candidate.id !== profile.id))
    })
  }

  async function clearProfile(profile: BrowserProfile) {
    const confirmed = await api.showConfirm(
      `Clear data for “${profile.name}”?`,
      'This signs the profile out of websites and removes its local site data.',
    )
    if (!confirmed) return
    run(async () => {
      await api.clearBrowserProfileData(profile.id)
      setMessage(`Cleared saved site data for ${profile.name}.`)
    })
  }

  function updateAgentAccess(enabled: boolean) {
    setAgentSaving(true)
    setMessage(null)
    void setAgentAccess(enabled)
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : 'Agent browser access could not update.',
        )
      })
      .finally(() => setAgentSaving(false))
  }

  return {
    agentAccessEnabled: settings.enableAgentBrowserAccess,
    agentSaving,
    busy,
    defaultProfileId: settings.browserDefaultProfileId,
    message,
    name,
    profiles,
    userProfileCount: settings.browserProfiles.length,
    addProfile,
    clearProfile,
    removeProfile,
    renameProfile,
    setDefaultProfile: (profileId: string) => run(() => setDefault(profileId)),
    setName,
    updateAgentAccess,
  }
}
