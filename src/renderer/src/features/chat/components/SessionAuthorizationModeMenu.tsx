import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { SessionDetail } from '@shared/types/session'
import { Check, ChevronDown, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useDraftAuthorizationModeStore } from '@/features/chat/state/draft-authorization-mode-store'
import { usePreferencesStore, useProjectAuthorizationDefault } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS, MENU_SECTION_LABEL_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'

function compactLabel(mode: AgentAuthorizationMode) {
  return mode === 'yolo' ? 'YOLO' : 'Ask for approval'
}

function ModeMenuItem({
  checked,
  disabled,
  description,
  label,
  onSelect,
}: {
  readonly checked: boolean
  readonly disabled: boolean
  readonly description: string
  readonly label: string
  readonly onSelect: () => void
}) {
  return (
    <Button
      aria-label={label}
      aria-checked={checked}
      className={DENSE_MENU_ITEM_CLASS}
      disabled={disabled}
      fullWidth
      onClick={onSelect}
      role="menuitemradio"
      variant="row"
    >
      <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col items-start">
          <span className="truncate font-medium text-text-primary">{label}</span>
          <span className="text-xs font-normal text-text-tertiary">{description}</span>
        </span>
        {checked ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-accent" /> : null}
      </span>
    </Button>
  )
}

/** Session access control with a compact trigger and canonical, inheritance-aware menu labels. */
export function SessionAuthorizationModeMenu({
  projectPath: draftProjectPath = null,
  session,
  onSetAuthorizationMode,
}: {
  readonly projectPath?: string | null
  readonly session: SessionDetail | null
  readonly onSetAuthorizationMode: (
    authorizationMode: AgentAuthorizationMode | null,
  ) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const projectPath = session?.projectPath ?? draftProjectPath
  const draftOverride = useDraftAuthorizationModeStore((state) =>
    projectPath ? state.byProjectPath[projectPath] : undefined,
  )
  const setDraftOverride = useDraftAuthorizationModeStore((state) => state.setOverride)
  const globalDefault = usePreferencesStore((state) => state.settings.defaultAuthorizationMode)
  const projectDefault = useProjectAuthorizationDefault(projectPath)
  const persistedOverride = session?.authorizationMode ?? null
  const override = session ? persistedOverride : (draftOverride ?? null)
  const inheritedEffective = projectDefault ?? globalDefault
  const effective = override ?? inheritedEffective
  const compact = compactLabel(effective)
  const disabled = saving || (!session && !projectPath)

  async function select(next: AgentAuthorizationMode) {
    if (disabled || next === effective) {
      setOpen(false)
      return
    }

    if (!session) {
      if (projectPath) setDraftOverride(projectPath, next)
      setOpen(false)
      return
    }

    setSaving(true)
    try {
      await onSetAuthorizationMode(next)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover
      className="w-72 p-1.5"
      onOpenChange={setOpen}
      open={open}
      placement="top-start"
      role="menu"
      trigger={({ toggle }) => (
        <Button
          aria-label={`Session access mode: ${compact}`}
          className={
            effective === 'yolo'
              ? 'flex h-8 items-center gap-2 rounded-lg px-2 text-accent transition-colors hover:bg-accent/10'
              : 'flex h-8 items-center gap-2 rounded-lg px-2 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary'
          }
          disabled={disabled}
          leftIcon={<ShieldCheck aria-hidden="true" className="size-3.5" />}
          onClick={toggle}
          rightIcon={<ChevronDown aria-hidden="true" className="size-3" />}
          variant="unstyled"
        >
          {compact}
        </Button>
      )}
    >
      <div className={MENU_SECTION_LABEL_CLASS}>Agent access</div>
      {AGENT_AUTHORIZATION_MODES.map((mode) => (
        <ModeMenuItem
          checked={effective === mode}
          description={
            mode === 'yolo'
              ? 'Approve authorization requests automatically'
              : 'Ask before protected actions'
          }
          disabled={saving}
          key={mode}
          label={AGENT_AUTHORIZATION_MODE_LABELS[mode]}
          onSelect={() => void select(mode)}
        />
      ))}
    </Popover>
  )
}
