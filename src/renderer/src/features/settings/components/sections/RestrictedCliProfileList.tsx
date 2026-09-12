import type { LocalSessionProfileSummary } from '@shared/types/local-session-profile-management'
import { Plus, RefreshCw, ShieldOff } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

function scopeLabel(profile: LocalSessionProfileSummary) {
  if (profile.scope.all) return 'All Sessions'
  const count =
    (profile.scope.projectPaths?.length ?? 0) +
    (profile.scope.sessionIds?.length ?? 0) +
    (profile.scope.hiveRootSessionIds?.length ?? 0)
  return `${count} scoped target${count === 1 ? '' : 's'}`
}

function ProfileRow(props: {
  readonly profile: LocalSessionProfileSummary
  readonly onEdit: () => void
  readonly onRotate: () => void
  readonly onRevoke: () => void
}) {
  const { profile } = props
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 first:border-t-0">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-text-primary">{profile.name}</span>
          {profile.revokedAt ? <span className="text-xs text-error-text">Revoked</span> : null}
        </div>
        <p className="text-xs text-text-tertiary">
          {profile.capabilities.length} capabilities · {scopeLabel(profile)} ·{' '}
          {profile.authorizationCeiling === 'yolo' ? 'YOLO ceiling' : 'Approval ceiling'}
        </p>
      </div>
      {profile.revokedAt === null ? (
        <div className="flex items-center gap-1.5">
          <Button onClick={props.onEdit}>Edit</Button>
          <Button aria-label={`Rotate ${profile.name}`} size="icon-md" onClick={props.onRotate}>
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            aria-label={`Revoke ${profile.name}`}
            size="icon-md"
            variant="danger"
            onClick={props.onRevoke}
          >
            <ShieldOff className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function RestrictedCliProfileList(props: {
  readonly profiles: readonly LocalSessionProfileSummary[]
  readonly loading: boolean
  readonly onCreate: () => void
  readonly onEdit: (profile: LocalSessionProfileSummary) => void
  readonly onRotate: (profile: LocalSessionProfileSummary) => void
  readonly onRevoke: (profile: LocalSessionProfileSummary) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-xs text-text-tertiary">
          Credentials stay protected on this machine and are never shown after creation.
        </p>
        <Button leftIcon={<Plus className="size-3.5" />} onClick={props.onCreate}>
          New profile
        </Button>
      </div>
      {props.loading ? (
        <p className="px-4 py-4 text-xs text-text-muted">Loading profiles…</p>
      ) : null}
      {!props.loading && props.profiles.length === 0 ? (
        <p className="px-4 py-4 text-xs text-text-muted">No restricted profiles.</p>
      ) : null}
      {props.profiles.map((profile) => (
        <ProfileRow
          key={profile.id}
          profile={profile}
          onEdit={() => props.onEdit(profile)}
          onRotate={() => props.onRotate(profile)}
          onRevoke={() => props.onRevoke(profile)}
        />
      ))}
    </div>
  )
}
