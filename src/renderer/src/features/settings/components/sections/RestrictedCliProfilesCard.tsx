import { ChevronDown, ChevronRight, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { RestrictedCliProfileDialog } from './RestrictedCliProfileDialog'
import { RestrictedCliProfileList } from './RestrictedCliProfileList'
import { useRestrictedCliProfiles } from './use-restricted-cli-profiles'

export function RestrictedCliProfilesCard() {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const [open, setOpen] = useState(false)
  const profiles = useRestrictedCliProfiles(open)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="space-y-2">
      <Button
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 rounded-md p-1 text-left hover:bg-bg-hover"
        onClick={() => setOpen((current) => !current)}
        variant="unstyled"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-text-tertiary" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-text-primary">Restricted CLI profiles</h4>
              <span className="rounded-md border border-border-light px-1.5 py-0.5 text-xs text-text-tertiary">
                {profiles.profiles.length}
              </span>
            </div>
            <p className="text-xs leading-5 text-text-tertiary">
              Optional, revocable identities for external agentic tools. Normal local CLI use needs
              no profile.
            </p>
          </div>
        </div>
        <Chevron className="mt-1 size-4 shrink-0 text-text-tertiary" />
      </Button>
      {open ? (
        <RestrictedCliProfileList
          profiles={profiles.profiles}
          loading={profiles.loading}
          onCreate={() => profiles.setEditing('create')}
          onEdit={profiles.setEditing}
          onRotate={(profile) => void profiles.rotate(profile)}
          onRevoke={(profile) => void profiles.revoke(profile)}
        />
      ) : null}
      {profiles.error ? (
        <p className="text-xs text-error-text" role="alert">
          {profiles.error}
        </p>
      ) : null}
      {profiles.editing ? (
        <RestrictedCliProfileDialog
          defaultProjectPath={projectPath}
          {...(profiles.editing === 'create' ? {} : { profile: profiles.editing })}
          onClose={() => profiles.setEditing(null)}
          onSave={async (value) => {
            await profiles.mutate(
              value.operation === 'create'
                ? { ...value, operation: 'create' }
                : { ...value, operation: 'update', profileName: value.name },
            )
          }}
        />
      ) : null}
    </div>
  )
}
