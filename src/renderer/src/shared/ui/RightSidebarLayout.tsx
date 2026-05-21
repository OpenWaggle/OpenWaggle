import { useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { RightSidebarDockedLayout } from './RightSidebarDockedLayout'
import { RightSidebarSheet } from './RightSidebarSheet'
import {
  clampWidth,
  persistWidth,
  pixelValue,
  readStoredWidth,
  sidebarWidthValue,
} from './right-sidebar-layout-sizing'
import type { RightSidebarLayoutProps } from './right-sidebar-layout-types'

export { sidebarWidthValue } from './right-sidebar-layout-sizing'

function useStoredSidebarWidth({
  defaultWidth,
  maxWidth,
  minWidth,
  storageKey,
}: Pick<
  RightSidebarLayoutProps['sizing'],
  'defaultWidth' | 'maxWidth' | 'minWidth' | 'storageKey'
>) {
  const [width, setWidth] = useState(() =>
    clampWidth(readStoredWidth(storageKey, defaultWidth), minWidth, maxWidth),
  )
  const widthRef = useRef(width)

  function commitWidth(nextWidth: number) {
    const clampedWidth = clampWidth(nextWidth, minWidth, maxWidth)
    widthRef.current = clampedWidth
    setWidth(clampedWidth)
    persistWidth(storageKey, clampedWidth)
  }

  return { commitWidth, setWidth, width, widthRef }
}

export function RightSidebarLayout({
  children,
  open,
  sizing,
  sidebar,
  onOpenChange,
  shouldAcceptWidth,
}: RightSidebarLayoutProps) {
  const { defaultWidth, mainMinWidth, maxWidth, minWidth, sheetBreakpointPx, storageKey } = sizing
  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const hasOpenedRef = useRef(false)
  const { commitWidth, width, widthRef } = useStoredSidebarWidth({
    defaultWidth,
    maxWidth,
    minWidth,
    storageKey,
  })
  const isSheet = useMediaQuery(`(max-width: ${String(sheetBreakpointPx)}px)`)
  const shouldRenderSidebar = hasOpenedRef.current || open

  useEffect(() => {
    widthRef.current = width
    sidebarRef.current?.style.setProperty(
      'width',
      open ? sidebarWidthValue(width, mainMinWidth) : pixelValue(0),
    )
    panelRef.current?.style.setProperty('width', '100%')
  }, [mainMinWidth, open, width, widthRef])

  useEffect(() => {
    const panel = panelRef.current
    const activeElement = document.activeElement
    if (open || !panel || !activeElement || !panel.contains(activeElement)) return
    mainRef.current?.focus({ preventScroll: true })
  }, [open])

  function captureSidebar(node: HTMLDivElement | null) {
    sidebarRef.current = node
    if (node && open) hasOpenedRef.current = true
  }

  function applyWidth(nextWidth: number) {
    widthRef.current = nextWidth
    sidebarRef.current?.style.setProperty('width', sidebarWidthValue(nextWidth, mainMinWidth))
    panelRef.current?.style.setProperty('width', '100%')
  }

  if (isSheet) {
    return (
      <>
        {children}
        {shouldRenderSidebar ? (
          <RightSidebarSheet open={open} onOpenChange={onOpenChange}>
            {sidebar}
          </RightSidebarSheet>
        ) : null}
      </>
    )
  }

  return (
    <RightSidebarDockedLayout
      content={{ children, sidebar }}
      refs={{ mainRef, panelRef, rootRef, sidebarRef, widthRef }}
      rail={{
        actions: { applyWidth, commitWidth },
        bounds: { maxWidth, mainMinWidth, minWidth },
        state: { open, width },
        shouldAcceptWidth,
      }}
      shell={{ mainMinWidth, open, shouldRenderSidebar, width, captureSidebar }}
    />
  )
}
