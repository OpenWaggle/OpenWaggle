import type { ReactNode, RefObject } from 'react'

export interface WidthAcceptanceContext {
  readonly nextWidth: number
  readonly panel: HTMLDivElement
  readonly root: HTMLDivElement
  readonly sidebar: HTMLDivElement
}

export interface RightSidebarLayoutProps {
  readonly children: ReactNode
  readonly open: boolean
  readonly sidebar: ReactNode
  readonly sizing: RightSidebarSizing
  readonly onOpenChange: (open: boolean) => void
  readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean
}

export interface RightSidebarSizing {
  readonly defaultWidth: number
  readonly mainMinWidth: number
  readonly maxWidth: number
  readonly minWidth: number
  readonly sheetBreakpointPx: number
  readonly storageKey: string
}

export interface ResizeRailRefs {
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly sidebarRef: RefObject<HTMLDivElement | null>
  readonly widthRef: RefObject<number>
}

export interface ResizeRailBounds {
  readonly maxWidth: number
  readonly mainMinWidth: number
  readonly minWidth: number
}

export interface ResizeRailActions {
  readonly applyWidth: (width: number) => void
  readonly commitWidth: (width: number) => void
}

export interface ResizeRailStateInput {
  readonly open: boolean
  readonly width: number
}
