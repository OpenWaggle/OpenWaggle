import type { BrowserProfile } from '@shared/types/browser-profile'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

interface BrowserAgentAccessSectionProps {
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (enabled: boolean) => void
}

export function BrowserAgentAccessSection({
  checked,
  disabled,
  onChange,
}: BrowserAgentAccessSectionProps) {
  return (
    <section className="space-y-3" aria-labelledby="agent-browser-access-heading">
      <h3 id="agent-browser-access-heading" className="text-base font-semibold text-text-primary">
        Agent access
      </h3>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-primary">
            Let agents open and drive the preview browser
          </div>
          <div className="mt-0.5 text-xs text-text-tertiary">
            When off, browser tools and their instructions are withheld from agent sessions. Your
            own browser panel is unaffected.
          </div>
        </div>
        <ToggleSwitch
          checked={checked}
          disabled={disabled}
          label="Let agents open and drive the preview browser"
          onCheckedChange={onChange}
        />
      </div>
    </section>
  )
}

interface BrowserDefaultProfileSectionProps {
  readonly busy: boolean
  readonly defaultProfileId: string
  readonly onChange: (profileId: string) => void
  readonly profiles: readonly BrowserProfile[]
}

export function BrowserDefaultProfileSection({
  busy,
  defaultProfileId,
  onChange,
  profiles,
}: BrowserDefaultProfileSectionProps) {
  return (
    <section className="space-y-3" aria-labelledby="default-browser-profile-heading">
      <h3
        id="default-browser-profile-heading"
        className="text-base font-semibold text-text-primary"
      >
        Default profile
      </h3>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
        <div>
          <div className="text-xs font-medium text-text-primary">New preview tabs use</div>
          <div className="text-xs text-text-tertiary">Change profiles per tab at any time.</div>
        </div>
        <Select
          aria-label="Default browser profile"
          value={defaultProfileId}
          disabled={busy}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
      </div>
    </section>
  )
}
