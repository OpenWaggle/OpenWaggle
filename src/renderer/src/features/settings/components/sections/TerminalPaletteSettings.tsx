import {
  DEFAULT_APPEARANCE_TERMINAL_PALETTE,
  type TerminalPaletteRole,
} from '@shared/types/appearance-preferences'
import { RotateCcw } from 'lucide-react'
import { useAppearanceName } from '@/shared/hooks/useAppearanceName'
import { useSyntaxThemeRuntimeStore } from '@/shared/lib/syntax/syntax-theme-runtime'
import {
  readTerminalPaletteFallback,
  resolveTerminalPalette,
  type TerminalPalette,
} from '@/shared/lib/terminal-palette'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { usePreferencesStore } from '../../state'
import { TerminalPaletteRoleRow } from './TerminalPaletteRoleRow'

const PALETTE_ROLES = [
  { role: 'background', label: 'Background', detail: 'Canvas behind shell output.' },
  { role: 'foreground', label: 'Foreground', detail: 'Default prompt and command text.' },
  { role: 'cursor', label: 'Cursor', detail: 'Active insertion point.' },
  { role: 'selection', label: 'Selection', detail: 'Selected terminal output.' },
  { role: 'scrollbar', label: 'Scrollbar', detail: 'Scrollback position marker.' },
] as const satisfies readonly {
  readonly role: TerminalPaletteRole
  readonly label: string
  readonly detail: string
}[]

function TerminalPalettePreview({ palette }: { readonly palette: TerminalPalette }) {
  return (
    <div className="p-3 lg:border-r lg:border-border">
      <div
        role="img"
        aria-label="Live terminal color preview with prompt, selection, cursor, and scrollbar"
        className="relative min-h-40 overflow-hidden rounded-md border border-border-light p-4 font-mono text-xs leading-6"
        style={{ backgroundColor: palette.background, color: palette.foreground }}
      >
        <div>
          <span style={{ color: palette.cursor }}>~/openwaggle</span> git status
        </div>
        <div>On branch feature/terminal</div>
        <div>
          <span className="rounded-sm px-0.5" style={{ backgroundColor: palette.selection }}>
            terminal palette ready
          </span>
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-4 w-1 translate-y-1"
            style={{ backgroundColor: palette.cursor }}
          />
        </div>
        <div
          className="absolute inset-y-2 right-1 w-1 rounded-full bg-transparent"
          aria-hidden="true"
        >
          <div
            className="mt-8 h-12 w-1 rounded-full"
            style={{ backgroundColor: palette.scrollbar }}
          />
        </div>
      </div>
      <p className="mt-2 text-xs leading-4 text-text-muted">
        Theme values remain the base. Overrides apply to every terminal, including restored panes.
      </p>
    </div>
  )
}

export function TerminalPaletteSettings() {
  const appearance = useAppearanceName()
  const overrides = usePreferencesStore(
    (state) => state.settings.appearancePreferences.terminalPalette,
  )
  const setPalette = usePreferencesStore((state) => state.setAppearanceTerminalPalette)
  const selections = useSyntaxThemeRuntimeStore((state) => state.selections)
  const resources = useSyntaxThemeRuntimeStore((state) => state.resources)
  const showToast = useUIStore((state) => state.showToast)
  const resolution = resolveTerminalPalette({
    appearance,
    overrides,
    selections,
    resources,
    fallback: readTerminalPaletteFallback(),
  })
  const hasOverrides = Object.values(overrides).some((value) => value !== null)

  function update(role: TerminalPaletteRole, color: string | null) {
    void setPalette({ [role]: color }).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : 'Could not save terminal colors.', 'error')
    })
  }

  function resetAll() {
    void setPalette(DEFAULT_APPEARANCE_TERMINAL_PALETTE).catch((error: unknown) => {
      showToast(
        error instanceof Error ? error.message : 'Could not reset terminal colors.',
        'error',
      )
    })
  }

  return (
    <section className="space-y-3" aria-labelledby="terminal-palette-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="terminal-palette-heading" className="text-base font-semibold text-text-primary">
            Terminal colors
          </h3>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">
            Start from the active syntax theme, then tune terminal-only roles without changing code
            or review colors.
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          leftIcon={<RotateCcw className="size-3.5" />}
          disabled={!hasOverrides}
          onClick={resetAll}
        >
          Reset to theme
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <div className="grid lg:grid-cols-[minmax(15rem,0.8fr)_minmax(24rem,1.2fr)]">
          <TerminalPalettePreview palette={resolution.palette} />
          <div className="border-t border-border lg:border-t-0">
            {PALETTE_ROLES.map(({ role, label, detail }) => (
              <TerminalPaletteRoleRow
                key={`${role}:${overrides[role] ?? resolution.palette[role]}`}
                role={role}
                label={label}
                detail={detail}
                effectiveColor={resolution.palette[role]}
                override={overrides[role]}
                onCommit={update}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
