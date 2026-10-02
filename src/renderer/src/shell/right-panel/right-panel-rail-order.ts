import {
  BUILT_IN_RIGHT_PANEL_SURFACE_IDS,
  type RightPanelSurfaceId,
} from '@/shared/lib/right-panel-surfaces'

/** Built-in surfaces that sit on the rail below the fixed All panels entry. */
export const DEFAULT_BUILT_IN_RAIL_ORDER: readonly RightPanelSurfaceId[] =
  BUILT_IN_RIGHT_PANEL_SURFACE_IDS.filter((id) => id !== 'all-panels')

export type RailMove =
  | { readonly type: 'up' }
  | { readonly type: 'down' }
  | { readonly type: 'before'; readonly target: RightPanelSurfaceId }
  | { readonly type: 'after'; readonly target: RightPanelSurfaceId }

/** Default order: built-ins, then extension panels in install (registry) order. */
export function defaultRailOrder(known: readonly RightPanelSurfaceId[]) {
  const extensions = known.filter((id) => !DEFAULT_BUILT_IN_RAIL_ORDER.includes(id))
  return [...DEFAULT_BUILT_IN_RAIL_ORDER, ...extensions]
}

/**
 * The user's whole order including surfaces absent right now (an extension that does not apply
 * to this project keeps its slot). Built-ins the stored order predates are inserted at their
 * default position; newly known extension panels join the end.
 */
export function fullRailOrder(
  stored: readonly RightPanelSurfaceId[] | null,
  known: readonly RightPanelSurfaceId[],
): RightPanelSurfaceId[] {
  if (stored === null) return defaultRailOrder(known)
  const order: RightPanelSurfaceId[] = stored.filter((id) => id !== 'all-panels')
  DEFAULT_BUILT_IN_RAIL_ORDER.forEach((id, defaultIndex) => {
    if (order.includes(id)) return
    const previous = DEFAULT_BUILT_IN_RAIL_ORDER.slice(0, defaultIndex)
      .map((candidate) => order.indexOf(candidate))
      .filter((index) => index >= 0)
    const insertAt = previous.length > 0 ? Math.max(...previous) + 1 : 0
    order.splice(insertAt, 0, id)
  })
  for (const id of known) if (!order.includes(id)) order.push(id)
  return order
}

/** Surfaces on the rail right now, in the user's order. */
export function visibleRailOrder(
  stored: readonly RightPanelSurfaceId[] | null,
  known: readonly RightPanelSurfaceId[],
  hidden: readonly RightPanelSurfaceId[],
) {
  return fullRailOrder(stored, known).filter((id) => known.includes(id) && !hidden.includes(id))
}

function neighbour(
  visible: readonly RightPanelSurfaceId[],
  surface: RightPanelSurfaceId,
  delta: number,
) {
  const index = visible.indexOf(surface)
  if (index < 0) return null
  return visible[index + delta] ?? null
}

/** Moves one surface relative to another visible surface, returning the new full order. */
export function moveRailSurface(
  full: readonly RightPanelSurfaceId[],
  visible: readonly RightPanelSurfaceId[],
  surface: RightPanelSurfaceId,
  move: RailMove,
): RightPanelSurfaceId[] {
  const placement =
    move.type === 'up'
      ? { target: neighbour(visible, surface, -1), after: false }
      : move.type === 'down'
        ? { target: neighbour(visible, surface, 1), after: true }
        : { target: move.target, after: move.type === 'after' }
  const target = placement.target
  if (target === null || target === surface || !full.includes(target)) return [...full]
  const order = full.filter((id) => id !== surface)
  const targetIndex = order.indexOf(target)
  order.splice(placement.after ? targetIndex + 1 : targetIndex, 0, surface)
  return order
}
