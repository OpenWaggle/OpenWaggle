import { describe, expect, it } from 'vitest'
import {
  extensionRightPanelSurfaceId,
  type RightPanelSurfaceId,
} from '@/shared/lib/right-panel-surfaces'
import {
  DEFAULT_BUILT_IN_RAIL_ORDER,
  defaultRailOrder,
  fullRailOrder,
  moveRailSurface,
  visibleRailOrder,
} from '../right-panel-rail-order'

const LINEAR = extensionRightPanelSurfaceId({ extensionId: 'linear', sidePanelId: 'issues' })
const COVERAGE = extensionRightPanelSurfaceId({ extensionId: 'coverage', sidePanelId: 'map' })
const KNOWN: RightPanelSurfaceId[] = [...DEFAULT_BUILT_IN_RAIL_ORDER, LINEAR, COVERAGE]

describe('Panel rail order', () => {
  it('defaults to built-ins in catalog order, then extensions in install order', () => {
    expect(defaultRailOrder(KNOWN)).toEqual([
      'changes',
      'project-actions',
      'browser',
      'files',
      'session-tree',
      'resources',
      LINEAR,
      COVERAGE,
    ])
    expect(defaultRailOrder(KNOWN)).not.toContain('all-panels')
  })

  it('places a built-in the stored order predates at its default position', () => {
    const stored: RightPanelSurfaceId[] = [
      'browser',
      'changes',
      'session-tree',
      'files',
      'resources',
    ]
    expect(fullRailOrder(stored, KNOWN)).toEqual([
      'browser',
      'changes',
      'project-actions',
      'session-tree',
      'files',
      'resources',
      LINEAR,
      COVERAGE,
    ])
  })

  it('keeps an absent extension in its slot and appends newly known ones', () => {
    const stored: RightPanelSurfaceId[] = [LINEAR, ...DEFAULT_BUILT_IN_RAIL_ORDER]
    const withoutLinear = KNOWN.filter((id) => id !== LINEAR)
    expect(fullRailOrder(stored, withoutLinear)).toEqual([
      LINEAR,
      ...DEFAULT_BUILT_IN_RAIL_ORDER,
      COVERAGE,
    ])
    expect(visibleRailOrder(stored, withoutLinear, [])).toEqual([
      ...DEFAULT_BUILT_IN_RAIL_ORDER,
      COVERAGE,
    ])
  })

  it('hides unpinned surfaces from the visible rail only', () => {
    expect(visibleRailOrder(null, KNOWN, ['files', LINEAR])).toEqual([
      'changes',
      'project-actions',
      'browser',
      'session-tree',
      'resources',
      COVERAGE,
    ])
  })

  it('moves a surface past its visible neighbours, skipping hidden ones', () => {
    const full = fullRailOrder(null, KNOWN)
    const visible = visibleRailOrder(null, KNOWN, ['browser'])
    expect(moveRailSurface(full, visible, 'files', { type: 'up' }).slice(0, 4)).toEqual([
      'changes',
      'files',
      'project-actions',
      'browser',
    ])
    expect(moveRailSurface(full, visible, 'changes', { type: 'up' })).toEqual(full)
    expect(moveRailSurface(full, visible, 'resources', { type: 'down' }).slice(-3)).toEqual([
      LINEAR,
      'resources',
      COVERAGE,
    ])
  })

  it('drops a dragged surface before or after a target', () => {
    const full = fullRailOrder(null, KNOWN)
    const visible = visibleRailOrder(null, KNOWN, [])
    expect(moveRailSurface(full, visible, COVERAGE, { type: 'before', target: 'changes' })[0]).toBe(
      COVERAGE,
    )
    const after = moveRailSurface(full, visible, 'changes', { type: 'after', target: 'browser' })
    expect(after.slice(0, 3)).toEqual(['project-actions', 'browser', 'changes'])
    expect(moveRailSurface(full, visible, 'changes', { type: 'after', target: 'changes' })).toEqual(
      full,
    )
  })
})
