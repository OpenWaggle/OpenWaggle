import type { BrowserProfile } from '@shared/types/browser-profile'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'

const PROFILE_NAME_MAX_LENGTH = 48

interface BrowserProfileRowProps {
  readonly busy: boolean
  readonly custom: boolean
  readonly profile: BrowserProfile
  readonly onClear: (profile: BrowserProfile) => void
  readonly onDelete: (profile: BrowserProfile) => void
  readonly onRename: (profile: BrowserProfile, name: string) => void
}

export function BrowserProfileRow({
  busy,
  custom,
  profile,
  onClear,
  onDelete,
  onRename,
}: BrowserProfileRowProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name)
  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onRename(profile, trimmed)
    setEditing(false)
  }

  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-t border-border px-4 py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            aria-label={`Name for ${profile.name}`}
            value={name}
            maxLength={PROFILE_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save()
              if (event.key === 'Escape') setEditing(false)
            }}
            className="h-7 w-full rounded-md border border-input-card-border bg-bg-secondary px-2 text-xs text-text-primary outline-none"
          />
        ) : (
          <>
            <div className="truncate text-xs font-medium text-text-primary">{profile.name}</div>
            <div className="text-xs text-text-tertiary">
              {profile.kind === 'incognito'
                ? 'Cleared when OpenWaggle quits'
                : 'Keeps logins and site data'}
            </div>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <Button size="icon-sm" variant="ghost" aria-label="Save profile name" onClick={save}>
              <Check className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel profile rename"
              onClick={() => {
                setName(profile.name)
                setEditing(false)
              }}
            >
              <X className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            {profile.kind === 'persistent' ? (
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => onClear(profile)}>
                Clear data
              </Button>
            ) : null}
            {custom ? (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Rename ${profile.name}`}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Delete ${profile.name}`}
                  onClick={() => onDelete(profile)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
