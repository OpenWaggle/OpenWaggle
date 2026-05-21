import type { SessionTreeFilterMode } from '@shared/types/session'

const NODE_DOT_SIZE_PX = 14
const ROW_HEIGHT_PX = 40

export const SESSION_TREE = {
  FILTER_OPTIONS: [
    { value: 'default', label: 'Default' },
    { value: 'no-tools', label: 'No tools' },
    { value: 'user-only', label: 'User only' },
    { value: 'labeled-only', label: 'Labeled' },
    { value: 'all', label: 'All' },
  ] as const satisfies readonly { readonly value: SessionTreeFilterMode; readonly label: string }[],
  LAYOUT: {
    NODE_DOT_SIZE_PX,
    NODE_DOT_OFFSET_PX: NODE_DOT_SIZE_PX / 2,
    CONNECTOR_STROKE_WIDTH_PX: 1.5,
    CONNECTOR_ACTIVE_STROKE: 'color-mix(in srgb, var(--color-accent) 58%, transparent)',
    CONNECTOR_ACTIVE_FILTER:
      'drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 24%, transparent))',
    CONNECTOR_MUTED_STROKE: 'color-mix(in srgb, var(--color-border-light) 58%, transparent)',
    CONNECTOR_ANCESTOR_STROKE: 'color-mix(in srgb, var(--color-border-light) 38%, transparent)',
    GUTTER_START_PX: 14,
    DEPTH_STEP_PX: 24,
    GUTTER_END_PADDING_PX: 22,
    ROW_HEIGHT_PX,
    ROW_CENTER_Y_PX: ROW_HEIGHT_PX / 2,
    CONNECTOR_ROW_OVERLAP_PX: 1,
    ROOT_VISUAL_DEPTH: 0,
  },
  TRAVERSAL: {
    FIRST_INDEX: 0,
    NEXT_ITEM_DELTA: 1,
    PREVIOUS_ITEM_DELTA: -1,
  },
}

export function isSessionTreeFilterMode(value: string): value is SessionTreeFilterMode {
  return SESSION_TREE.FILTER_OPTIONS.some((option) => option.value === value)
}
