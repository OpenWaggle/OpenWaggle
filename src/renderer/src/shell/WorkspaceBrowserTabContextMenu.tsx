import { useRef } from 'react'
import { useMenuKeyboard } from '@/shared/hooks/useMenuKeyboard'
import { Button } from '@/shared/ui/Button'
import { ContextMenu } from '@/shared/ui/ContextMenu'

interface WorkspaceBrowserTabContextMenuProps {
  readonly model: {
    readonly open: boolean
    readonly position: { readonly x: number; readonly y: number }
    readonly tabIds: readonly string[]
    readonly targetId: string
    readonly targetAudioMuted: boolean
    readonly targetMaterialized: boolean
  }
  readonly actions: {
    readonly close: () => void
    readonly closeTabs: (previewIds: readonly string[]) => void
    readonly setAudioMuted: (previewId: string, audioMuted: boolean) => void
  }
}

function MenuButton(props: {
  readonly disabled?: boolean
  readonly label: string
  readonly onSelect: () => void
}) {
  return (
    <Button
      type="button"
      role="menuitem"
      tabIndex={-1}
      variant="unstyled"
      disabled={props.disabled}
      className="flex w-full px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40"
      onClick={props.onSelect}
    >
      {props.label}
    </Button>
  )
}

export function WorkspaceBrowserTabContextMenu(props: WorkspaceBrowserTabContextMenuProps) {
  const { actions, model } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const handleKeyDown = useMenuKeyboard({
    enabled: true,
    isOpen: model.open,
    panelRef: menuRef,
    onClose: actions.close,
  })
  const targetIndex = model.tabIds.indexOf(model.targetId)
  const right = targetIndex < 0 ? [] : model.tabIds.slice(targetIndex + 1)
  const others = model.tabIds.filter((id) => id !== model.targetId)
  const select = (ids: readonly string[]) => {
    actions.close()
    actions.closeTabs(ids)
  }
  const toggleAudio = () => {
    actions.close()
    actions.setAudioMuted(model.targetId, !model.targetAudioMuted)
  }

  return (
    <ContextMenu open={model.open} onClose={actions.close} position={model.position}>
      <div ref={menuRef} role="menu" aria-label="Browser tab actions" onKeyDown={handleKeyDown}>
        {model.targetMaterialized ? (
          <MenuButton
            label={model.targetAudioMuted ? 'Unmute tab' : 'Mute tab'}
            onSelect={toggleAudio}
          />
        ) : null}
        <MenuButton label="Close" onSelect={() => select([model.targetId])} />
        <MenuButton
          label="Close others"
          disabled={others.length === 0}
          onSelect={() => select(others)}
        />
        <MenuButton
          label="Close tabs to the right"
          disabled={right.length === 0}
          onSelect={() => select(right)}
        />
        <MenuButton label="Close all" onSelect={() => select(model.tabIds)} />
      </div>
    </ContextMenu>
  )
}
