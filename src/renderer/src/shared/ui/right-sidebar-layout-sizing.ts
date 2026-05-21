import type { CSSProperties } from 'react'

export const RESIZE_MOVE_THRESHOLD_PX = 2
export const RESIZE_RAIL_HALF_WIDTH_PX = 8
export const RESIZE_BODY_CLASS = 'right-sidebar-resizing'
export const SHEET_MAX_WIDTH_PX = 820
export const SHEET_VIEWPORT_WIDTH = '88vw'
const ZERO_WIDTH_PX = 0
const STORAGE_RADIX = 10

export function clampWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.max(minWidth, Math.min(width, maxWidth))
}

export function readStoredWidth(storageKey: string, fallbackWidth: number) {
  if (typeof window === 'undefined') return fallbackWidth

  const raw = window.localStorage.getItem(storageKey)
  if (!raw) return fallbackWidth

  const parsed = Number.parseInt(raw, STORAGE_RADIX)
  return Number.isFinite(parsed) ? parsed : fallbackWidth
}

export function persistWidth(storageKey: string, width: number) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, String(width))
}

export function pixelValue(value: number) {
  return `${String(value)}px`
}

export function sidebarWidthValue(width: number, mainMinWidth: number): string {
  return `min(${pixelValue(width)}, max(${pixelValue(ZERO_WIDTH_PX)}, calc(100% - ${pixelValue(mainMinWidth)})))`
}

export function sidebarShellStyle(
  open: boolean,
  width: number,
  mainMinWidth: number,
): CSSProperties {
  return { width: open ? sidebarWidthValue(width, mainMinWidth) : ZERO_WIDTH_PX }
}

export function sidebarPanelStyle(): CSSProperties {
  return { width: '100%' }
}

export function resizeRailRightValue(open: boolean, width: number, mainMinWidth: number) {
  return open
    ? `calc(${sidebarWidthValue(width, mainMinWidth)} - ${pixelValue(RESIZE_RAIL_HALF_WIDTH_PX)})`
    : pixelValue(ZERO_WIDTH_PX)
}

export function resizeRailStyle(open: boolean, width: number, mainMinWidth: number): CSSProperties {
  return { right: resizeRailRightValue(open, width, mainMinWidth) }
}

export function clampedVisibleWidth(
  width: number,
  minWidth: number,
  maxWidth: number,
  rootWidth: number,
  mainMinWidth: number,
) {
  const maxVisibleWidth = Math.max(ZERO_WIDTH_PX, rootWidth - mainMinWidth)
  return Math.min(clampWidth(width, minWidth, maxWidth), maxVisibleWidth)
}
