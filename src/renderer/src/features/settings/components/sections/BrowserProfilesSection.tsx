import { useBrowserProfilesSettings } from '@/features/settings/hooks/useBrowserProfilesSettings'
import { BrowserCookieImportCard } from './BrowserCookieImportCard'
import { BrowserPreviewDefaultsSection } from './BrowserPreviewDefaultsSection'
import { BrowserProfileCreateForm } from './BrowserProfileCreateForm'
import { BrowserProfileList } from './BrowserProfileList'
import {
  BrowserAgentAccessSection,
  BrowserDefaultProfileSection,
} from './BrowserProfilePreferenceSections'

export function BrowserProfilesSection() {
  const controller = useBrowserProfilesSettings()

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-text-primary">Browser</h2>
        <p className="mt-1 text-sm text-text-tertiary">
          Keep project logins isolated, browse ephemerally, or bring existing browser sessions with
          you.
        </p>
      </header>

      <BrowserAgentAccessSection
        checked={controller.agentAccessEnabled}
        disabled={controller.agentSaving}
        onChange={controller.updateAgentAccess}
      />

      <BrowserDefaultProfileSection
        busy={controller.busy}
        defaultProfileId={controller.defaultProfileId}
        profiles={controller.profiles}
        onChange={controller.setDefaultProfile}
      />

      <BrowserPreviewDefaultsSection />

      <section className="space-y-3" aria-labelledby="browser-profiles-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 id="browser-profiles-heading" className="text-base font-semibold text-text-primary">
              Profiles
            </h3>
            <p className="text-xs text-text-tertiary">
              Default and custom profiles persist. Incognito never does.
            </p>
          </div>
          <BrowserProfileCreateForm
            busy={controller.busy}
            name={controller.name}
            userProfileCount={controller.userProfileCount}
            onNameChange={controller.setName}
            onSubmit={controller.addProfile}
          />
        </div>
        <BrowserProfileList
          busy={controller.busy}
          profiles={controller.profiles}
          onClear={(profile) => void controller.clearProfile(profile)}
          onDelete={(profile) => void controller.removeProfile(profile)}
          onRename={controller.renameProfile}
        />
      </section>

      {controller.message ? (
        <p role="status" className="text-xs text-text-secondary">
          {controller.message}
        </p>
      ) : null}
      <BrowserCookieImportCard profiles={controller.profiles} />
    </div>
  )
}
