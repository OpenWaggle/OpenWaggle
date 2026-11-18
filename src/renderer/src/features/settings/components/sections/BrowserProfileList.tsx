import { type BrowserProfile, isBuiltInBrowserProfileId } from '@shared/types/browser-profile'
import { BrowserProfileRow } from './BrowserProfileRow'

interface BrowserProfileListProps {
  readonly busy: boolean
  readonly onClear: (profile: BrowserProfile) => void
  readonly onDelete: (profile: BrowserProfile) => void
  readonly onRename: (profile: BrowserProfile, name: string) => void
  readonly profiles: readonly BrowserProfile[]
}

export function BrowserProfileList({
  busy,
  onClear,
  onDelete,
  onRename,
  profiles,
}: BrowserProfileListProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {profiles.map((profile) => (
        <BrowserProfileRow
          key={profile.id}
          profile={profile}
          custom={!isBuiltInBrowserProfileId(profile.id)}
          busy={busy}
          onClear={onClear}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
    </div>
  )
}
