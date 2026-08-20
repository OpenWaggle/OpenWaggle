import {
  DEFAULT_SHORTCUT_BINDINGS,
  isMandatoryShortcutCommand,
  SHORTCUT_DEFINITIONS,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutCommand,
  type ShortcutDefinition,
  shortcutBindingKey,
} from '@shared/types/shortcuts'
import { RotateCcw } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { formatShortcutBinding, usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

function eventBinding(event: KeyboardEvent<HTMLButtonElement>): ShortcutBinding | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const apple = usesAppleShortcuts()
  const key =
    event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  return {
    key,
    ...((apple ? event.metaKey : event.ctrlKey) ? { mod: true } : {}),
    ...(apple && event.ctrlKey ? { ctrl: true } : {}),
    ...(!apple && event.metaKey ? { meta: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
  }
}

function conflictingCommand(
  command: ShortcutCommand,
  binding: ShortcutBinding,
  bindings: ReturnType<typeof usePreferencesStore.getState>['settings']['shortcutBindings'],
) {
  const candidate = shortcutBindingKey(binding)
  return SHORTCUT_DEFINITIONS.find((definition) => {
    const existing = bindings[definition.command]
    return (
      definition.command !== command &&
      existing !== null &&
      shortcutBindingKey(existing) === candidate
    )
  })
}

interface ShortcutRowProps {
  readonly binding: ShortcutBinding | null
  readonly definition: ShortcutDefinition
  readonly index: number
  readonly isRecording: boolean
  readonly onKeyDown: (command: ShortcutCommand, event: KeyboardEvent<HTMLButtonElement>) => void
  readonly onRecord: (command: ShortcutCommand) => void
  readonly onSave: (command: ShortcutCommand, binding: ShortcutBinding | null) => void
}

function ShortcutRow({
  binding,
  definition,
  index,
  isRecording,
  onKeyDown,
  onRecord,
  onSave,
}: ShortcutRowProps) {
  const defaultBinding = DEFAULT_SHORTCUT_BINDINGS[definition.command]
  const isDefault =
    binding !== null && shortcutBindingKey(binding) === shortcutBindingKey(defaultBinding)
  return (
    <div
      className={`flex min-h-16 items-center gap-4 px-4 ${
        index > 0 ? 'border-t border-border' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-text-primary">{definition.label}</div>
        <div className="mt-0.5 text-[11px] text-text-tertiary">{definition.description}</div>
      </div>
      {!isDefault && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Reset shortcut"
          aria-label={`Reset ${definition.label}`}
          onClick={() => onSave(definition.command, defaultBinding)}
        >
          <RotateCcw className="size-3" />
        </Button>
      )}
      <Button
        variant="unstyled"
        onClick={() => onRecord(definition.command)}
        onKeyDown={(event) => onKeyDown(definition.command, event)}
        className={`min-w-28 rounded-md border px-3 py-1.5 font-mono text-[11px] outline-none ${
          isRecording
            ? 'border-accent bg-accent/10 text-accent ring-2 ring-accent/20'
            : 'border-border-light bg-bg text-text-secondary hover:bg-bg-hover'
        }`}
        aria-label={`Change ${definition.label}`}
      >
        {isRecording ? 'Press keys…' : formatShortcutBinding(binding)}
      </Button>
    </div>
  )
}

export function ShortcutsSection() {
  const bindings: ShortcutBindings = usePreferencesStore((state) => state.settings.shortcutBindings)
  const setShortcutBinding = usePreferencesStore((state) => state.setShortcutBinding)
  const resetShortcutBindings = usePreferencesStore((state) => state.resetShortcutBindings)
  const showToast = useUIStore((state) => state.showToast)
  const [recording, setRecording] = useState<ShortcutCommand | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function saveBinding(command: ShortcutCommand, binding: ShortcutBinding | null) {
    if (binding) {
      const conflict = conflictingCommand(command, binding, bindings)
      if (conflict) {
        setError(`Already used by “${conflict.label}”.`)
        return
      }
    }

    try {
      await setShortcutBinding(command, binding)
      setRecording(null)
      setError(null)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save shortcut.'
      setError(message)
      showToast(message, 'error')
    }
  }

  function handleKeyDown(command: ShortcutCommand, event: KeyboardEvent<HTMLButtonElement>) {
    if (recording !== command) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setRecording(null)
      setError(null)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (isMandatoryShortcutCommand(command)) {
        setError('This core shortcut must stay assigned. Record a replacement instead.')
        return
      }
      void saveBinding(command, null)
      return
    }

    const binding = eventBinding(event)
    if (!binding) return
    if (!binding.mod && !binding.ctrl && !binding.alt && !binding.meta) {
      setError('Use Command, Control, or Alt with the key.')
      return
    }
    void saveBinding(command, binding)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-[16px] font-semibold text-text-primary">Keyboard shortcuts</h2>
          <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
            Select a shortcut, then press the replacement. Conflicting bindings are rejected.
          </p>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => void resetShortcutBindings()}
          leftIcon={<RotateCcw className="size-3" />}
        >
          Reset all
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
        {SHORTCUT_DEFINITIONS.map((definition, index) => {
          const binding = bindings[definition.command]
          return (
            <ShortcutRow
              key={definition.command}
              binding={binding}
              definition={definition}
              index={index}
              isRecording={recording === definition.command}
              onKeyDown={handleKeyDown}
              onRecord={(command) => {
                setRecording(command)
                setError(null)
              }}
              onSave={(command, nextBinding) => void saveBinding(command, nextBinding)}
            />
          )
        })}
      </div>

      {error && (
        <p role="alert" className="text-[12px] text-error">
          {error}
        </p>
      )}
      <p className="text-[11px] text-text-muted">
        Workspace shortcuts can be cleared with Backspace while recording. Command palette, Go to
        file, and New session always require a binding.
      </p>
    </div>
  )
}
