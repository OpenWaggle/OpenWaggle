import {
  normalizeTerminalPaletteColor,
  type TerminalPaletteRole,
} from '@shared/types/appearance-preferences'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'

const HEX_COLOR_PREFIX = '#'
const OPAQUE_HEX_COLOR_LENGTH = 7
const HEX_COLOR_WITH_ALPHA_LENGTH = 9
const HEX_ALPHA_START = 7
const FIRST_RGB_CAPTURE = 1
const AFTER_LAST_RGB_CAPTURE = 4
const COLOR_CHANNEL_MAX = 255
const HEX_RADIX = 16
const HEX_BYTE_WIDTH = 2
const COLOR_PICKER_FALLBACK = `${HEX_COLOR_PREFIX}${'000000'}`

interface TerminalPaletteRoleRowProps {
  readonly role: TerminalPaletteRole
  readonly label: string
  readonly detail: string
  readonly effectiveColor: string
  readonly override: string | null
  readonly onCommit: (role: TerminalPaletteRole, color: string | null) => void
}

function colorPickerValue(color: string) {
  const normalized = normalizeTerminalPaletteColor(color)
  if (normalized !== null) return normalized.slice(0, OPAQUE_HEX_COLOR_LENGTH)
  const channels = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/iu)
  if (!channels) return COLOR_PICKER_FALLBACK
  return `${HEX_COLOR_PREFIX}${channels
    .slice(FIRST_RGB_CAPTURE, AFTER_LAST_RGB_CAPTURE)
    .map((channel) =>
      Math.min(COLOR_CHANNEL_MAX, Number(channel))
        .toString(HEX_RADIX)
        .padStart(HEX_BYTE_WIDTH, '0'),
    )
    .join('')}`
}

export function TerminalPaletteRoleRow({
  role,
  label,
  detail,
  effectiveColor,
  override,
  onCommit,
}: TerminalPaletteRoleRowProps) {
  const displayColor = override ?? effectiveColor
  const [draft, setDraft] = useState(displayColor)
  const [error, setError] = useState<string | null>(null)
  const inputId = `terminal-palette-${role}`
  const errorId = `${inputId}-error`

  function commitDraft() {
    if (draft.trim().toLowerCase() === displayColor.trim().toLowerCase()) return
    const normalized = normalizeTerminalPaletteColor(draft)
    if (normalized === null) {
      setError('Enter a 3, 4, 6, or 8 digit hex color.')
      return
    }
    setDraft(normalized)
    setError(null)
    onCommit(role, normalized)
  }

  function chooseColor(color: string) {
    const normalizedDisplay = normalizeTerminalPaletteColor(displayColor)
    const alpha =
      normalizedDisplay?.length === HEX_COLOR_WITH_ALPHA_LENGTH
        ? normalizedDisplay.slice(HEX_ALPHA_START)
        : ''
    const normalized = `${color.toLowerCase()}${alpha}`
    setDraft(normalized)
    setError(null)
    onCommit(role, normalized)
  }

  return (
    <div className="grid grid-cols-1 gap-2 border-b border-border px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(9rem,1fr)_minmax(11rem,14rem)] sm:gap-3">
      <label htmlFor={inputId} className="min-w-0 self-center">
        <span className="flex items-center gap-2 text-xs font-medium text-text-primary">
          {label}
          <span className="text-xs font-normal uppercase tracking-wide text-text-muted">
            {override === null ? 'Theme' : 'Custom'}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-text-muted">{detail}</span>
      </label>
      <div className="min-w-0 self-center">
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={`${label} color picker`}
            value={colorPickerValue(displayColor)}
            onChange={(event) => chooseColor(event.currentTarget.value)}
            className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
          <input
            id={inputId}
            type="text"
            spellCheck={false}
            value={draft}
            aria-label={`${label} hex color`}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
            onChange={(event) => {
              setDraft(event.currentTarget.value)
              setError(null)
            }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(displayColor)
                setError(null)
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-border bg-bg-secondary px-2 py-1.5 font-mono text-xs text-text-primary aria-invalid:border-error/60"
          />
          <Button
            type="button"
            size="icon-md"
            variant="ghost"
            aria-label={`Reset ${label} to theme`}
            disabled={override === null}
            onClick={() => onCommit(role, null)}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="mt-1 text-xs text-error-text">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
