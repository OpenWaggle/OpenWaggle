import {
  type AppearanceTypographyPreferences,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CODE_LINE_HEIGHT_MAX,
  CODE_LINE_HEIGHT_MIN,
  DOCUMENT_FONT_SIZE_MAX,
  DOCUMENT_FONT_SIZE_MIN,
  DOCUMENT_LINE_HEIGHT_MAX,
  DOCUMENT_LINE_HEIGHT_MIN,
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '@shared/types/appearance-preferences'
import { NumberStepper } from '@/shared/ui/NumberStepper'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const PERCENTAGE_STEP = 5
const CODE_LINE_HEIGHT_FONT_SIZE_GAP = 2

function NumberSetting({
  label,
  detail,
  value,
  minimum,
  maximum,
  step,
  suffix,
  onChange,
}: {
  readonly label: string
  readonly detail: string
  readonly value: number
  readonly minimum: number
  readonly maximum: number
  readonly step?: number
  readonly suffix: string
  readonly onChange: (value: number) => void
}) {
  const inputId = `appearance-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <label htmlFor={inputId}>
        <span className="block text-xs font-medium text-text-primary">{label}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{detail}</span>
      </label>
      <NumberStepper
        id={inputId}
        label={label}
        value={value}
        minimum={minimum}
        maximum={maximum}
        step={step}
        suffix={suffix}
        onValueChange={onChange}
      />
    </div>
  )
}

function ToggleSetting({
  label,
  detail,
  checked,
  onChange,
}: {
  readonly label: string
  readonly detail: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
      <span>
        <span className="block text-xs font-medium text-text-primary">{label}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{detail}</span>
      </span>
      <ToggleSwitch checked={checked} onCheckedChange={onChange} label={label} size="compact" />
    </div>
  )
}

interface TypographyControlProps {
  readonly typography: AppearanceTypographyPreferences
  readonly onUpdate: (patch: Partial<AppearanceTypographyPreferences>) => void
}

function BasicTypographyControls({ typography, onUpdate }: TypographyControlProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <NumberSetting
        label="Interface scale"
        detail="Scales app text and spacing together."
        value={typography.interfaceScale}
        minimum={INTERFACE_SCALE_MIN}
        maximum={INTERFACE_SCALE_MAX}
        step={PERCENTAGE_STEP}
        suffix="%"
        onChange={(interfaceScale) => onUpdate({ interfaceScale })}
      />
      <NumberSetting
        label="Document text"
        detail="Chat and rendered Markdown size."
        value={typography.documentFontSize}
        minimum={DOCUMENT_FONT_SIZE_MIN}
        maximum={DOCUMENT_FONT_SIZE_MAX}
        suffix="px"
        onChange={(documentFontSize) => onUpdate({ documentFontSize })}
      />
      <NumberSetting
        label="Code text"
        detail="Editor, code blocks, diffs, and structured data."
        value={typography.codeFontSize}
        minimum={CODE_FONT_SIZE_MIN}
        maximum={CODE_FONT_SIZE_MAX}
        suffix="px"
        onChange={(codeFontSize) =>
          onUpdate({
            codeFontSize,
            codeLineHeight: Math.max(
              typography.codeLineHeight,
              codeFontSize + CODE_LINE_HEIGHT_FONT_SIZE_GAP,
            ),
          })
        }
      />
    </div>
  )
}

function AdvancedTypographyControls({ typography, onUpdate }: TypographyControlProps) {
  return (
    <details className="group overflow-hidden rounded-lg border border-border bg-bg">
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary">
        <span className="flex items-center justify-between">
          Advanced typography
          <span
            className="text-text-muted transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            ›
          </span>
        </span>
      </summary>
      <div className="border-t border-border">
        <NumberSetting
          label="Document spacing"
          detail="Line height for longer reading."
          value={typography.documentLineHeight}
          minimum={DOCUMENT_LINE_HEIGHT_MIN}
          maximum={DOCUMENT_LINE_HEIGHT_MAX}
          step={PERCENTAGE_STEP}
          suffix="%"
          onChange={(documentLineHeight) => onUpdate({ documentLineHeight })}
        />
        <NumberSetting
          label="Code line height"
          detail="Vertical space between editor lines."
          value={typography.codeLineHeight}
          minimum={Math.max(
            CODE_LINE_HEIGHT_MIN,
            typography.codeFontSize + CODE_LINE_HEIGHT_FONT_SIZE_GAP,
          )}
          maximum={CODE_LINE_HEIGHT_MAX}
          suffix="px"
          onChange={(codeLineHeight) => onUpdate({ codeLineHeight })}
        />
        <NumberSetting
          label="Terminal text"
          detail="Font size inside the built-in terminal."
          value={typography.terminalFontSize}
          minimum={TERMINAL_FONT_SIZE_MIN}
          maximum={TERMINAL_FONT_SIZE_MAX}
          suffix="px"
          onChange={(terminalFontSize) => onUpdate({ terminalFontSize })}
        />
        <ToggleSetting
          label="Code ligatures"
          detail="Use programming ligatures when the selected font provides them."
          checked={typography.codeLigatures}
          onChange={(codeLigatures) => onUpdate({ codeLigatures })}
        />
        <ToggleSetting
          label="Terminal follows Code font"
          detail="Keep editor and terminal typefaces in sync."
          checked={typography.terminalUsesCodeFont}
          onChange={(terminalUsesCodeFont) => onUpdate({ terminalUsesCodeFont })}
        />
      </div>
    </details>
  )
}

export function TypographyControls(props: TypographyControlProps) {
  return (
    <>
      <BasicTypographyControls {...props} />
      <AdvancedTypographyControls {...props} />
    </>
  )
}
