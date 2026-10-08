import type { ChangeRequestOpenDestination } from '@shared/types/git'
import { useQuery } from '@tanstack/react-query'
import {
  changeRequestOpenDestinationQueryOptions,
  useSourceControlQueryFreshness,
} from '@/queries/source-control'
import { SegmentedRadioGroup } from '@/shared/ui/SegmentedRadioGroup'
import { useSourceControlConfigure } from './use-source-control-configure'

const DESTINATION_OPTIONS = [
  { value: 'inspector', label: 'OpenWaggle' },
  { value: 'website', label: 'Provider website' },
] as const satisfies readonly { readonly value: ChangeRequestOpenDestination; label: string }[]

/** The user-wide Change request open destination; a project's private override still wins. */
export function ChangeRequestOpenDestinationSetting() {
  useSourceControlQueryFreshness()
  const resolution = useQuery(changeRequestOpenDestinationQueryOptions(null))
  const { configureOrToast, pending } = useSourceControlConfigure()
  const current = resolution.data?.destination ?? null
  // Until the user picks one, the shown value is inherited (default or a project's shared file),
  // so picking it again still records the user's own choice.
  const userChose = resolution.data?.source === 'user'

  const choose = (destination: ChangeRequestOpenDestination) => {
    if (destination === current && userChose) return
    configureOrToast({ kind: 'set-open-destination', scope: 'user', destination })
  }

  return (
    <div className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-border bg-bg px-5 py-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-text-primary">Open pull and merge requests in</div>
        <div className="mt-0.5 text-xs text-text-tertiary">
          Cmd/Ctrl-click a request to use the other one.
        </div>
        {resolution.isError ? (
          <p role="alert" className="mt-1 text-xs text-error-text">
            Could not read this setting: {resolution.error.message}
          </p>
        ) : null}
      </div>
      <SegmentedRadioGroup
        label="Open pull and merge requests in"
        options={DESTINATION_OPTIONS}
        value={current}
        pending={pending || resolution.isPending}
        onSelect={choose}
      />
    </div>
  )
}
