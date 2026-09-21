import { isUpdateChannel, type UpdateChannel } from '@shared/types/update-channel'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Select } from '@/shared/ui/Select'

const logger = createRendererLogger('settings/update-channel')
const CHANNEL_REFRESH_INTERVAL_MS = 5_000

export function UpdateChannelSetting() {
  const channel = usePreferencesStore((state) => state.settings.updateChannel)
  const setUpdateChannel = usePreferencesStore((state) => state.setUpdateChannel)
  const [saving, setSaving] = useState(false)
  const refreshGenerationRef = useRef(0)
  const savingRef = useRef(false)

  const refreshAuthoritativeChannel = useCallback(async (duringSave = false) => {
    if (savingRef.current && !duringSave) return null

    const generation = ++refreshGenerationRef.current
    try {
      const authoritativeChannel = (await api.getSettings()).updateChannel
      if (generation !== refreshGenerationRef.current) return null

      usePreferencesStore.setState((state) => ({
        settings: { ...state.settings, updateChannel: authoritativeChannel },
      }))
      return authoritativeChannel
    } catch (error: unknown) {
      logger.warn('Failed to refresh release channel', { error: String(error) })
      return null
    }
  }, [])

  useEffect(() => {
    void refreshAuthoritativeChannel()

    const refresh = () => void refreshAuthoritativeChannel()
    const interval = window.setInterval(refresh, CHANNEL_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)

    return () => {
      refreshGenerationRef.current += 1
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [refreshAuthoritativeChannel])

  const choose = async (next: UpdateChannel) => {
    if (savingRef.current) return
    savingRef.current = true
    refreshGenerationRef.current += 1
    setSaving(true)
    try {
      const authoritativeChannel = await refreshAuthoritativeChannel(true)
      if (next === authoritativeChannel) return

      if (
        next === 'alpha' &&
        !(await api.showConfirm(
          'Switch to Alpha updates?',
          'Alpha builds are the least tested and may update automatically. You can return to Stable or Beta at any time.',
        ))
      ) {
        return
      }
      await setUpdateChannel(next)
      refreshGenerationRef.current += 1
    } catch (error: unknown) {
      logger.warn('Failed to update release channel', { error: String(error) })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-14 items-center justify-between border-b border-border px-5 py-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor="update-channel" className="text-xs font-medium text-text-primary">
          Update channel
        </label>
        <span className="text-xs text-text-tertiary">
          Stable receives production releases. Beta and Alpha also receive less-tested builds.
        </span>
      </div>
      <Select
        id="update-channel"
        aria-label="Update channel"
        value={channel}
        disabled={saving}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (isUpdateChannel(next)) void choose(next)
        }}
      >
        <option value="stable">Stable</option>
        <option value="beta">Beta</option>
        <option value="alpha">Alpha</option>
      </Select>
    </div>
  )
}
