import { Check, ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'
import { syntaxLanguageCatalog } from '@/shared/lib/syntax/language-registry'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { TextInput } from '@/shared/ui/TextInput'
import { workspaceLanguagePatternLabel } from '../lib/workspace-language-associations'

export function WorkspaceLanguageMenu({
  language,
  filePath,
  onChange,
  onAssociatePattern,
}: {
  readonly language: string
  readonly filePath: string
  readonly onChange: (language: string) => void
  readonly onAssociatePattern: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const catalog = syntaxLanguageCatalog()
  const selected = catalog.find((entry) => entry.id === language)
  const normalizedQuery = query.trim().toLowerCase()
  const visible = normalizedQuery
    ? catalog.filter(
        (entry) =>
          entry.name.toLowerCase().includes(normalizedQuery) ||
          entry.id.toLowerCase().includes(normalizedQuery) ||
          entry.aliases.some((alias) => alias.toLowerCase().includes(normalizedQuery)),
      )
    : catalog

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="top-end"
      role="dialog"
      ariaLabel="Choose file language"
      className="w-72 p-2"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="xs"
          title="Choose the language for this file"
          onClick={toggle}
          rightIcon={<ChevronDown className="size-3" />}
        >
          {selected?.name ?? language}
        </Button>
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 rounded border border-border px-2">
        <Search className="size-3.5 text-text-muted" />
        <TextInput
          autoFocus
          variant="transparent"
          inputSize="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search languages"
          aria-label="Search languages"
          className="px-0 text-xs"
        />
      </div>
      <div className="max-h-64 overflow-auto">
        {visible.map((entry) => (
          <Button
            key={`${entry.provenance}:${entry.id}`}
            variant="unstyled"
            className="flex h-7 w-full items-center justify-between rounded px-2 text-left text-xs text-text-secondary hover:bg-bg-hover"
            aria-pressed={entry.id === language}
            onClick={() => {
              onChange(entry.id)
              setOpen(false)
              setQuery('')
            }}
          >
            <span>{entry.name}</span>
            {entry.id === language ? <Check className="size-3" /> : null}
          </Button>
        ))}
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <Button
          variant="ghost"
          size="xs"
          className="w-full justify-start"
          onClick={() => {
            onAssociatePattern()
            setOpen(false)
          }}
        >
          Use {selected?.name ?? language} for {workspaceLanguagePatternLabel(filePath)}
        </Button>
      </div>
    </Popover>
  )
}
