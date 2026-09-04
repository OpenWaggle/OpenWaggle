import type { AppearanceTypographyPreferences } from '@shared/types/appearance-preferences'
import { Check, ChevronDown } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { TextInput } from '@/shared/ui/TextInput'
import {
  CODE_FONT_CHOICES,
  type FontChoice,
  fontChoiceAvailable,
  INTERFACE_FONT_CHOICES,
} from './typography-font-choices'

interface FontRoleConfig {
  readonly label: string
  readonly description: string
  readonly value: string
  readonly inputLabel: string
  readonly preview: ReactNode
  readonly previewStyle: CSSProperties
  readonly choices: readonly FontChoice[]
  readonly disabled?: boolean
}

function matchingChoice(value: string, choices: readonly FontChoice[]) {
  return choices.find((choice) => choice.fontFamily === value)
}

function FontPicker({
  config,
  onCommit,
}: {
  readonly config: FontRoleConfig
  readonly onCommit: (fontFamily: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [editingCustom, setEditingCustom] = useState(false)
  const selected = matchingChoice(config.value, config.choices)
  const selectedAvailable = selected ? fontChoiceAvailable(selected) : true
  const showCustomInput = editingCustom || !selected
  const currentLabel = config.disabled
    ? 'Following Code'
    : selected && !selectedAvailable
      ? `${selected.label} · Not installed`
      : (selected?.label ?? 'Custom')

  function commitCustom(input: HTMLInputElement) {
    const next = input.value.trim()
    if (!next) {
      input.value = config.value
      return
    }
    if (next !== config.value) onCommit(next)
  }

  return (
    <div className="min-w-0">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        role="menu"
        className="w-full min-w-56 overflow-hidden p-1"
        trigger={({ toggle }) => (
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            disabled={config.disabled}
            aria-label={`${config.label} font: ${currentLabel}`}
            rightIcon={<ChevronDown className="size-3.5 text-text-muted" />}
            className="justify-between"
            onClick={toggle}
          >
            <span className="truncate" style={{ fontFamily: config.previewStyle.fontFamily }}>
              {currentLabel}
            </span>
          </Button>
        )}
      >
        {config.choices.map((choice) => {
          const available = fontChoiceAvailable(choice)
          return (
            <Button
              key={choice.id}
              variant="unstyled"
              role="menuitemradio"
              aria-checked={choice.fontFamily === config.value}
              disabled={!available}
              title={available ? undefined : `${choice.label} is not installed on this device`}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => {
                onCommit(choice.fontFamily)
                setEditingCustom(false)
                setOpen(false)
              }}
            >
              <span style={{ fontFamily: choice.fontFamily }}>{choice.label}</span>
              {available ? (
                choice.fontFamily === config.value ? (
                  <Check className="size-3.5 text-accent" />
                ) : null
              ) : (
                <span className="text-xs text-text-muted">Not installed</span>
              )}
            </Button>
          )
        })}
        <div className="my-1 border-t border-border" />
        <Button
          variant="unstyled"
          role="menuitemradio"
          aria-checked={!selected}
          className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          onClick={() => {
            setEditingCustom(true)
            setOpen(false)
          }}
        >
          Custom CSS stack…
          {!selected ? <Check className="size-3.5 text-accent" /> : null}
        </Button>
      </Popover>
      {showCustomInput && !config.disabled ? (
        <TextInput
          key={config.value}
          defaultValue={config.value}
          aria-label={config.inputLabel}
          inputSize="sm"
          monospace
          className="mt-1.5 text-xs"
          onBlur={(event) => commitCustom(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.currentTarget.value = config.value
              event.currentTarget.blur()
            }
          }}
        />
      ) : null}
    </div>
  )
}

function FontRoleRow({
  config,
  onCommit,
}: {
  readonly config: FontRoleConfig
  readonly onCommit: (fontFamily: string) => void
}) {
  return (
    <div
      className={`grid gap-2 border-b border-border px-3 py-2.5 last:border-b-0 md:grid-cols-12 md:items-center md:gap-3 ${
        config.disabled ? 'opacity-55' : ''
      }`}
    >
      <span className="md:col-span-3">
        <span className="block text-xs font-medium text-text-primary">{config.label}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{config.description}</span>
      </span>
      <span
        className="min-w-0 truncate text-sm text-text-primary md:col-span-5"
        style={config.previewStyle}
      >
        {config.preview}
      </span>
      <div className="md:col-span-4">
        <FontPicker config={config} onCommit={onCommit} />
      </div>
    </div>
  )
}

export function TypographyFontCards({
  typography,
  onUpdate,
}: {
  readonly typography: AppearanceTypographyPreferences
  readonly onUpdate: (patch: Partial<AppearanceTypographyPreferences>) => void
}) {
  return (
    <div className="overflow-visible rounded-lg border border-border bg-bg">
      <FontRoleRow
        config={{
          label: 'Interface',
          description: 'Navigation and controls',
          value: typography.interfaceFontFamily,
          inputLabel: 'Custom Interface font family',
          preview: 'OpenWaggle settings',
          previewStyle: { fontFamily: typography.interfaceFontFamily },
          choices: INTERFACE_FONT_CHOICES,
        }}
        onCommit={(interfaceFontFamily) => onUpdate({ interfaceFontFamily })}
      />
      <FontRoleRow
        config={{
          label: 'Documents',
          description: 'Chat and Markdown',
          value: typography.documentFontFamily,
          inputLabel: 'Custom Document font family',
          preview: 'A quieter way to read a long review.',
          previewStyle: {
            fontFamily: typography.documentFontFamily,
            fontSize: typography.documentFontSize,
          },
          choices: INTERFACE_FONT_CHOICES,
        }}
        onCommit={(documentFontFamily) => onUpdate({ documentFontFamily })}
      />
      <FontRoleRow
        config={{
          label: 'Code',
          description: 'Editor, diffs, and data',
          value: typography.codeFontFamily,
          inputLabel: 'Custom Code font family',
          preview: <code>{'const value: number = 42'}</code>,
          previewStyle: {
            fontFamily: typography.codeFontFamily,
            fontSize: typography.codeFontSize,
            fontVariantLigatures: typography.codeLigatures ? 'normal' : 'none',
          },
          choices: CODE_FONT_CHOICES,
        }}
        onCommit={(codeFontFamily) => onUpdate({ codeFontFamily })}
      />
      <FontRoleRow
        config={{
          label: 'Terminal',
          description: typography.terminalUsesCodeFont ? 'Uses the Code font' : 'Built-in terminal',
          value: typography.terminalFontFamily,
          inputLabel: 'Custom Terminal font family',
          preview: <code>$ pnpm test</code>,
          previewStyle: {
            fontFamily: typography.terminalUsesCodeFont
              ? typography.codeFontFamily
              : typography.terminalFontFamily,
            fontSize: typography.terminalFontSize,
          },
          choices: CODE_FONT_CHOICES,
          disabled: typography.terminalUsesCodeFont,
        }}
        onCommit={(terminalFontFamily) => onUpdate({ terminalFontFamily })}
      />
    </div>
  )
}
