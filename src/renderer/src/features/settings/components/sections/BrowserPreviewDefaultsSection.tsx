import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import {
  type BrowserPreviewDefaultActions,
  BrowserPreviewDefaultControls,
} from './BrowserPreviewDefaultControls'

export function BrowserPreviewDefaultsSection() {
  const settings = usePreferencesStore((state) => state.settings)
  const setAppearance = usePreferencesStore((state) => state.setBrowserDefaultAppearance)
  const setAutoShow = usePreferencesStore((state) => state.setBrowserAutoShowFloatingPreview)
  const setFrameRate = usePreferencesStore((state) => state.setBrowserRecordingFrameRate)
  const setViewport = usePreferencesStore((state) => state.setBrowserDefaultViewport)
  const setZoom = usePreferencesStore((state) => state.setBrowserDefaultZoomFactor)
  const actions: BrowserPreviewDefaultActions = {
    setAppearance,
    setAutoShow,
    setFrameRate,
    setViewport,
    setZoom,
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = (operation: () => Promise<void>) => {
    setSaving(true)
    setError(null)
    void operation()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Browser default could not be saved.')
      })
      .finally(() => setSaving(false))
  }

  return (
    <section className="space-y-3" aria-labelledby="browser-preview-defaults-heading">
      <div>
        <h3
          id="browser-preview-defaults-heading"
          className="text-base font-semibold text-text-primary"
        >
          Preview defaults
        </h3>
        <p className="text-xs text-text-tertiary">
          Applied before each new preview paints; open tabs keep their current controls.
        </p>
      </div>
      <BrowserPreviewDefaultControls
        actions={actions}
        disabled={saving}
        settings={settings}
        update={update}
      />
      {error !== null ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
