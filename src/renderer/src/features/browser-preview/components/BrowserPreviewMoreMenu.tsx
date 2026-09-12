import type { BrowserPreviewAppearance } from '@shared/types/browser-preview-controls'
import {
  Check,
  Cookie,
  Laptop,
  Maximize2,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Sun,
  Trash2,
  Wrench,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS, MENU_SECTION_LABEL_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'
import type { BrowserPreviewAdvancedControls } from '../hooks/useBrowserPreviewAdvancedControls'

interface BrowserPreviewMoreMenuProps {
  readonly advanced: BrowserPreviewAdvancedControls
}

interface MenuSectionProps {
  readonly advanced: BrowserPreviewAdvancedControls
}

interface MenuActionSectionProps extends MenuSectionProps {
  readonly runAndClose: (action: () => void) => void
}

const ZOOM_PERCENT_FACTOR = 100
const APPEARANCE_OPTIONS = [
  { value: 'system', label: 'System', icon: Laptop },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const satisfies ReadonlyArray<{
  readonly value: BrowserPreviewAppearance
  readonly label: string
  readonly icon: typeof Laptop
}>

function MenuSeparator() {
  return <hr className="my-1 border-0 border-t border-border" />
}

function PreviewActionMenu({ advanced, runAndClose }: MenuActionSectionProps) {
  const deviceToolbarOpen = advanced.controlState.viewport.mode === 'fixed'
  return (
    <>
      <Button
        role="menuitem"
        variant="unstyled"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => runAndClose(advanced.hardReload)}
      >
        <RefreshCw className="size-3.5" />
        Hard reload
      </Button>
      <Button
        role="menuitem"
        variant="unstyled"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => runAndClose(advanced.openDevTools)}
      >
        <Wrench className="size-3.5" />
        Open DevTools
      </Button>
      <Button
        role="menuitem"
        variant="unstyled"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => runAndClose(advanced.togglePictureInPicture)}
      >
        <Maximize2 className="size-3.5" />
        {advanced.controlState.pictureInPicture
          ? 'Close picture-in-picture'
          : 'Open picture-in-picture'}
      </Button>
      <Button
        role="menuitem"
        variant="unstyled"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => runAndClose(advanced.toggleDeviceToolbar)}
      >
        <MonitorSmartphone className="size-3.5" />
        {deviceToolbarOpen ? 'Close device toolbar' : 'Open device toolbar'}
      </Button>
    </>
  )
}

function PreviewZoomMenu({ advanced }: MenuSectionProps) {
  return (
    <>
      <div className={MENU_SECTION_LABEL_CLASS}>Zoom</div>
      <div className="grid grid-cols-3 gap-1">
        <Button
          role="menuitem"
          variant="unstyled"
          className="flex h-8 items-center justify-center rounded text-text-secondary hover:bg-bg-hover"
          aria-label="Zoom out"
          onClick={() => advanced.zoom('out')}
        >
          <ZoomOut className="size-3.5" />
        </Button>
        <Button
          role="menuitem"
          variant="unstyled"
          className="h-8 rounded font-mono text-xs tabular-nums text-text-secondary hover:bg-bg-hover"
          aria-label="Reset zoom"
          onClick={() => advanced.zoom('reset')}
        >
          {Math.round(advanced.controlState.zoomFactor * ZOOM_PERCENT_FACTOR)}%
        </Button>
        <Button
          role="menuitem"
          variant="unstyled"
          className="flex h-8 items-center justify-center rounded text-text-secondary hover:bg-bg-hover"
          aria-label="Zoom in"
          onClick={() => advanced.zoom('in')}
        >
          <ZoomIn className="size-3.5" />
        </Button>
      </div>
    </>
  )
}

function PreviewAppearanceMenu({ advanced }: MenuSectionProps) {
  return (
    <>
      <div className={MENU_SECTION_LABEL_CLASS}>Appearance</div>
      {APPEARANCE_OPTIONS.map((option) => {
        const Icon = option.icon
        return (
          <Button
            key={option.value}
            role="menuitemradio"
            aria-checked={advanced.controlState.appearance === option.value}
            variant="unstyled"
            className={DENSE_MENU_ITEM_CLASS}
            onClick={() => advanced.setAppearance(option.value)}
          >
            <Icon className="size-3.5" />
            <span className="flex-1">{option.label}</span>
            {advanced.controlState.appearance === option.value ? (
              <Check className="size-3.5 text-accent" />
            ) : null}
          </Button>
        )
      })}
    </>
  )
}

function PreviewSiteDataMenu({ advanced, runAndClose }: MenuActionSectionProps) {
  return (
    <>
      <div className={MENU_SECTION_LABEL_CLASS}>Site data</div>
      <Button
        role="menuitem"
        variant="unstyled"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => runAndClose(advanced.clearCookies)}
      >
        <Cookie className="size-3.5" />
        Clear cookies
      </Button>
      <Button
        role="menuitem"
        variant="unstyled"
        className={DENSE_MENU_ITEM_CLASS}
        onClick={() => runAndClose(advanced.clearCache)}
      >
        <Trash2 className="size-3.5" />
        Clear cache
      </Button>
    </>
  )
}

export function BrowserPreviewMoreMenu({ advanced }: BrowserPreviewMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const runAndClose = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      role="menu"
      className="w-64 p-1.5"
      trigger={({ toggle }) => (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Browser preview options"
          title="Browser preview options"
          onClick={toggle}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      )}
    >
      <PreviewActionMenu advanced={advanced} runAndClose={runAndClose} />
      <MenuSeparator />
      <PreviewZoomMenu advanced={advanced} />
      <MenuSeparator />
      <PreviewAppearanceMenu advanced={advanced} />
      <MenuSeparator />
      <PreviewSiteDataMenu advanced={advanced} runAndClose={runAndClose} />
    </Popover>
  )
}
