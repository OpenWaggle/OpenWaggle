import type { ActionCatalog, ActionCatalogEdit } from '@shared/types/action-definitions'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
export function PreparationProfileManager({
  profile,
  busy,
  apply,
  onSelect,
}: {
  readonly profile: ActionCatalog['profiles'][number] | undefined
  readonly busy: boolean
  readonly apply: (edit: ActionCatalogEdit) => Promise<boolean>
  readonly onSelect: (id: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <details>
      <summary className="cursor-pointer text-xs text-text-tertiary">Manage profiles</summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TextInput
          aria-label="New preparation profile name"
          placeholder="Profile name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          disabled={!name.trim() || busy}
          onClick={() => {
            const id = crypto.randomUUID()
            void apply({
              type: 'save-profile',
              storage: 'local',
              definition: { id, name: name.trim() },
            }).then((saved) => {
              if (!saved) return
              onSelect(id)
              setName('')
            })
          }}
        >
          Add profile
        </Button>
        {profile && profile.definition.id !== 'default' ? (
          <Button
            disabled={busy}
            onClick={() =>
              void apply({
                type: 'delete-profile',
                id: profile.definition.id,
                storage: profile.source === 'project' ? 'project' : 'local',
              })
            }
          >
            Remove empty profile
          </Button>
        ) : null}
      </div>
    </details>
  )
}
