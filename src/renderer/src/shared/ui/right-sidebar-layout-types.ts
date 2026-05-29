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
  readonly panel: RefObject<HTMLDivElement | null>
  readonly root: RefObject<HTMLDivElement | null>
  readonly sidebar: RefObject<HTMLDivElement | null>
  readonly width: RefObject<number>
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
