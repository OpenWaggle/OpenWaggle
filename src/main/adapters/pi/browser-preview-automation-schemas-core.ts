import { match } from '@diegogbrisa/ts-match'
import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
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
  protocol: Type.Optional(Type.Union([Type.Literal('http'), Type.Literal('https')])),
  path: Type.Optional(Type.String({ maxLength: BROWSER_PREVIEW_LIMITS.URL_LENGTH })),
})

export const previewNavigateParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  url: Type.Optional(url),
  target: Type.Optional(
    Type.Union([Type.Object({ kind: Type.Literal('url'), url }), environmentPortTarget]),
  ),
  readiness: Type.Optional(
    Type.Union([Type.Literal('load'), Type.Literal('domContentLoaded'), Type.Literal('none')]),
  ),
  timeoutMs: timeout,
})

function viewportDimension(description: string) {
  return Type.Integer({
    minimum: BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
    maximum: BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
    description,
  })
}

const preset = Type.Union(
  [
    Type.Literal('iphone-se'),
    Type.Literal('iphone-xr'),
    Type.Literal('iphone-12-pro'),
    Type.Literal('iphone-14-pro-max'),
    Type.Literal('pixel-7'),
    Type.Literal('samsung-galaxy-s8-plus'),
    Type.Literal('samsung-galaxy-s20-ultra'),
    Type.Literal('ipad-mini'),
    Type.Literal('ipad-air'),
    Type.Literal('ipad-pro'),
    Type.Literal('surface-pro-7'),
    Type.Literal('surface-duo'),
    Type.Literal('galaxy-z-fold-5'),
    Type.Literal('asus-zenbook-fold'),
    Type.Literal('samsung-galaxy-a51-71'),
    Type.Literal('nest-hub'),
    Type.Literal('nest-hub-max'),
  ],
  { description: 'Required when mode is preset.' },
)

const resizeMode = Type.Union(
  [Type.Literal('fill'), Type.Literal('freeform'), Type.Literal('preset')],
  {
    description:
      'fill sizes the viewport to the panel; freeform uses width and height; preset uses a named device.',
  },
)

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
      Type.Union([Type.Literal('portrait'), Type.Literal('landscape')], {
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
  colorScheme: Type.Union([Type.Literal('system'), Type.Literal('light'), Type.Literal('dark')]),
})
