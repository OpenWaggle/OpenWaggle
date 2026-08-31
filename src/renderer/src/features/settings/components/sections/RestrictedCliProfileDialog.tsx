import type { LocalSessionProfileSummary } from '@shared/types/local-session-profile-management'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { TextInput } from '@/shared/ui/TextInput'
import {
  RestrictedProfileAuthorizationField,
  RestrictedProfileCapabilityFields,
  RestrictedProfileScopeFields,
} from './RestrictedCliProfileFields'
import {
  type RestrictedCliProfileSaveCommand,
  useRestrictedCliProfileForm,
} from './restricted-cli-profile-form'

interface RestrictedCliProfileDialogProps {
  readonly profile?: LocalSessionProfileSummary
  readonly defaultProjectPath?: string | null
  readonly onClose: () => void
  readonly onSave: (command: RestrictedCliProfileSaveCommand) => Promise<void>
}

export function RestrictedCliProfileDialog(props: RestrictedCliProfileDialogProps) {
  const form = useRestrictedCliProfileForm(props)
  return (
    <ModalDialog labelledBy="restricted-profile-title" onClose={props.onClose}>
      <form
        className="space-y-5 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void form.submit()
        }}
      >
        <div className="space-y-1">
          <h3 className="text-base font-semibold" id="restricted-profile-title">
            {props.profile ? `Edit ${props.profile.name}` : 'Create restricted CLI profile'}
          </h3>
          <p className="text-xs leading-5 text-text-tertiary">
            Profiles add attribution and narrower authority for external agentic tools. They do not
            contain a hostile process already running as your OS user.
          </p>
        </div>
        <label
          className="block space-y-1.5 text-xs font-medium text-text-secondary"
          htmlFor="restricted-profile-name"
        >
          Profile name
          <TextInput
            id="restricted-profile-name"
            autoFocus={!props.profile}
            disabled={Boolean(props.profile)}
            value={form.name}
            onChange={(event) => form.setName(event.currentTarget.value)}
          />
        </label>
        <RestrictedProfileAuthorizationField
          value={form.authorizationCeiling}
          onChange={form.setAuthorizationCeiling}
        />
        <RestrictedProfileScopeFields
          all={form.all}
          projectPaths={form.projectPaths}
          sessionIds={form.sessionIds}
          hiveRootSessionIds={form.hiveRootSessionIds}
          onAllChange={form.setAll}
          onProjectPathsChange={form.setProjectPaths}
          onSessionIdsChange={form.setSessionIds}
          onHiveRootSessionIdsChange={form.setHiveRootSessionIds}
        />
        <RestrictedProfileCapabilityFields
          selected={form.capabilities}
          onToggle={form.toggleCapability}
        />
        {form.error ? (
          <p className="text-xs text-error-text" role="alert">
            {form.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button disabled={form.saving} onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={form.saving} type="submit" variant="primary">
            {form.saving ? 'Saving…' : props.profile ? 'Save profile' : 'Create profile'}
          </Button>
        </div>
      </form>
    </ModalDialog>
  )
}
