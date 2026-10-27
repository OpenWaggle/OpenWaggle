import { match } from '@diegogbrisa/ts-match'
import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
  isValidBrowserPreviewViewportSize,
} from '@shared/browser-preview-viewports'
import { BROWSER_PREVIEW_LIMITS } from '@shared/types/browser-preview'
import {
  BROWSER_PREVIEW_AUTOMATION_LIMITS,
  type BrowserPreviewAutomationResizeInput,
} from '@shared/types/browser-preview-automation'
import { type Static, Type } from 'typebox'

const MAX_TCP_PORT = 65_535

export const previewTabTargetParameters = Type.Object({
  tabId: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: BROWSER_PREVIEW_LIMITS.ID_LENGTH,
      description: 'Exact collaborative browser tab to target.',
    }),
  ),
})

/** Optional parts of a page snapshot; visible text, elements, and the screenshot are always sent. */
export const BROWSER_PREVIEW_SNAPSHOT_PARTS = [
  'accessibility',
  'console',
  'network',
  'actions',
] as const

export const previewSnapshotParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  include: Type.Optional(
    Type.Array(Type.Enum(BROWSER_PREVIEW_SNAPSHOT_PARTS), {
      uniqueItems: true,
      description:
        'Also send the accessibility tree, console entries, network entries, or action history.',
    }),
  ),
})

export type BrowserPreviewSnapshotPart = (typeof BROWSER_PREVIEW_SNAPSHOT_PARTS)[number]

const url = Type.String({
  minLength: 1,
  maxLength: BROWSER_PREVIEW_LIMITS.URL_LENGTH,
  description: 'An absolute or schemeless HTTP(S) URL.',
})

export const previewOpenParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  url: Type.Optional(url),
  open: Type.Optional(
    Type.Boolean({ description: 'Reveal the thread-bound preview. Defaults to true.' }),
  ),
  reuseExistingTab: Type.Optional(
    Type.Boolean({ description: 'Reuse the active tab. Defaults to true.' }),
  ),
})

const timeout = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: BROWSER_PREVIEW_AUTOMATION_LIMITS.MAX_TIMEOUT_MS,
    description: 'Maximum wait in milliseconds.',
  }),
)

const environmentPortTarget = Type.Object({
  kind: Type.Literal('environment-port'),
  port: Type.Integer({ minimum: 1, maximum: MAX_TCP_PORT }),
  protocol: Type.Optional(Type.Enum(['http', 'https'])),
  path: Type.Optional(Type.String({ maxLength: BROWSER_PREVIEW_LIMITS.URL_LENGTH })),
})

export const previewNavigateParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  url: Type.Optional(url),
  target: Type.Optional(
    Type.Union([Type.Object({ kind: Type.Literal('url'), url }), environmentPortTarget]),
  ),
  readiness: Type.Optional(Type.Enum(['load', 'domContentLoaded', 'none'])),
  timeoutMs: timeout,
})

function viewportDimension(description: string) {
  return Type.Integer({
    minimum: BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
    maximum: BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
    description,
  })
}

const preset = Type.Enum(
  [
    'iphone-se',
    'iphone-xr',
    'iphone-12-pro',
    'iphone-14-pro-max',
    'pixel-7',
    'samsung-galaxy-s8-plus',
    'samsung-galaxy-s20-ultra',
    'ipad-mini',
    'ipad-air',
    'ipad-pro',
    'surface-pro-7',
    'surface-duo',
    'galaxy-z-fold-5',
    'asus-zenbook-fold',
    'samsung-galaxy-a51-71',
    'nest-hub',
    'nest-hub-max',
  ],
  { description: 'Required when mode is preset.' },
)

const resizeMode = Type.Enum(['fill', 'freeform', 'preset'], {
  description:
    'fill sizes the viewport to the panel; freeform uses width and height; preset uses a named device.',
})

/*
 * One object with `mode` as the discriminator, not a root union of the three modes: Bedrock rejects
 * any tool whose parameter root is not `type: "object"`, and OpenAI rejects a root `anyOf`. Which
 * fields each mode requires is checked by `browserPreviewResizeInput` before the tool runs.
 */
export const previewResizeParameters = Type.Object(
  {
    ...previewTabTargetParameters.properties,
    mode: resizeMode,
    width: Type.Optional(viewportDimension('Required when mode is freeform.')),
    height: Type.Optional(viewportDimension('Required when mode is freeform.')),
    preset: Type.Optional(preset),
    orientation: Type.Optional(
      Type.Enum(['portrait', 'landscape'], {
        description: 'Only used when mode is preset.',
      }),
    ),
  },
  {
    description: `Viewport area may not exceed ${String(BROWSER_PREVIEW_VIEWPORT_MAX_AREA)} pixels.`,
  },
)

/** Narrows flat `preview_resize` arguments to one mode, rejecting a mode whose fields are missing. */
export function browserPreviewResizeInput(
  params: Static<typeof previewResizeParameters>,
): BrowserPreviewAutomationResizeInput {
  const target = params.tabId === undefined ? {} : { tabId: params.tabId }
  const { width, height, preset: presetId, orientation } = params
  return match(params.mode)
    .with('fill', () => ({ ...target, mode: 'fill' as const }))
    .with('freeform', () => {
      if (width === undefined || height === undefined) {
        throw new Error('preview_resize with mode "freeform" requires both width and height.')
      }
      // Checked here too so the user is never asked to approve a size the service rejects.
      if (!isValidBrowserPreviewViewportSize(width, height)) {
        throw new Error(
          `preview_resize with mode "freeform" exceeds the viewport limit: area may not exceed ${String(BROWSER_PREVIEW_VIEWPORT_MAX_AREA)} pixels.`,
        )
      }
      return { ...target, mode: 'freeform' as const, width, height }
    })
    .with('preset', () => {
      if (presetId === undefined) {
        throw new Error('preview_resize with mode "preset" requires preset.')
      }
      return {
        ...target,
        mode: 'preset' as const,
        preset: presetId,
        ...(orientation === undefined ? {} : { orientation }),
      }
    })
    .exhaustive()
}

export const previewAppearanceParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  colorScheme: Type.Enum(['system', 'light', 'dark']),
})
