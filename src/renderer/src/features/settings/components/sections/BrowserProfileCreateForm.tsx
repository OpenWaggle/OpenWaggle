import { BROWSER_PROFILE_LIMITS } from '@shared/types/browser-profile'
import { Plus } from 'lucide-react'
import type { SubmitEvent } from 'react'
import { Button } from '@/shared/ui/Button'

interface BrowserProfileCreateFormProps {
  readonly busy: boolean
  readonly name: string
  readonly onNameChange: (name: string) => void
  readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
  readonly userProfileCount: number
}

export function BrowserProfileCreateForm({
  busy,
  name,
  onNameChange,
  onSubmit,
  userProfileCount,
}: BrowserProfileCreateFormProps) {
  return (
    <form className="flex items-center gap-2" onSubmit={onSubmit}>
      <input
        aria-label="New browser profile name"
        value={name}
        maxLength={BROWSER_PROFILE_LIMITS.NAME_LENGTH}
        placeholder="Project login"
        onChange={(event) => onNameChange(event.currentTarget.value)}
        className="h-8 w-40 rounded-lg border border-input-card-border bg-bg-secondary px-2.5 text-xs text-text-primary outline-none"
      />
      <Button
        type="submit"
        size="sm"
        disabled={busy || !name.trim() || userProfileCount >= BROWSER_PROFILE_LIMITS.USER_PROFILES}
      >
        <Plus className="size-3.5" /> Add
      </Button>
    </form>
  )
}
