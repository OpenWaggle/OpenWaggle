import type { ShortcutBinding } from '@shared/types/shortcuts'
import { AlertTriangle } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/cn'
import { formatShortcutBinding, usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import type { ShortcutBrowserSource } from '../../lib/shortcut-browser-model'

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

export function isShortcutModifierKey(key: string) {
  return MODIFIER_KEYS.has(key)
}

function normalizedShortcutKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === ' ') return 'Space'
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

function shortcutBindingWithModifiers(
  event: KeyboardEvent<HTMLButtonElement>,
  applePlatform: boolean,
): ShortcutBinding {
  return {
    key: normalizedShortcutKey(event),
    ...((applePlatform ? event.metaKey : event.ctrlKey) ? { mod: true } : {}),
    ...(applePlatform && event.ctrlKey ? { ctrl: true } : {}),
    ...(!applePlatform && event.metaKey ? { meta: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
  }
}

function hasShortcutModifier(binding: ShortcutBinding) {
  return Boolean(binding.mod || binding.ctrl || binding.alt || binding.shift || binding.meta)
}

export function shortcutBindingFromEvent(
  event: KeyboardEvent<HTMLButtonElement>,
): ShortcutBinding | null {
  if (isShortcutModifierKey(event.key)) return null
  const binding = shortcutBindingWithModifiers(event, usesAppleShortcuts())
  return hasShortcutModifier(binding) ? binding : null
}

export function ShortcutSourceBadge({ source }: { readonly source: ShortcutBrowserSource }) {
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide',
        source === 'Project'
          ? 'border-accent/25 bg-accent/8 text-accent'
          : 'border-border bg-bg text-text-muted',
      )}
    >
      {source}
    </span>
  )
}

export function ShortcutConflictNotice({ labels }: { readonly labels: readonly string[] }) {
  if (labels.length === 0) return null
  return (
    <p className="flex items-start gap-1.5 text-xs text-warning">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Conflicts with {labels.map((label) => `“${label}”`).join(', ')}.
        {' The most recent active binding wins.'}
      </span>
    </p>
  )
}

interface ShortcutBindingButtonProps {
  readonly label: string
  readonly binding: ShortcutBinding | null
  readonly recording: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

export function ShortcutBindingButton(props: ShortcutBindingButtonProps) {
  return (
    <Button
      type="button"
      variant="unstyled"
      disabled={props.disabled}
      aria-label={props.label}
      data-shortcut-capture={props.recording ? '' : undefined}
      onClick={props.onClick}
      onKeyDown={props.onKeyDown}
      className={cn(
        'min-w-28 justify-center rounded-md border px-3 py-1.5 font-mono text-xs outline-none',
        props.recording
          ? 'border-accent bg-accent/10 text-accent ring-2 ring-accent/20'
          : 'border-border-light bg-bg text-text-secondary hover:bg-bg-hover',
      )}
    >
      {props.recording ? 'Press keys…' : formatShortcutBinding(props.binding)}
    </Button>
  )
}
