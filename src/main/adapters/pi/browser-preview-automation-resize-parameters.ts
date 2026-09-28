import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
} from '@shared/browser-preview-viewports'
import type { BrowserPreviewAutomationResizeInput } from '@shared/types/browser-preview-automation'
import { type TSchema, Type } from 'typebox'
import { Check, Errors } from 'typebox/value'
import { previewTabTargetParameters } from './browser-preview-automation-schemas-core'

const viewportDimension = Type.Integer({
  minimum: BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
  maximum: BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
})

const preset = Type.Union([
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
])

const orientation = Type.Union([Type.Literal('portrait'), Type.Literal('landscape')])

// Per-mode contracts. They are closed so a field that belongs to another mode is
// reported to the model instead of being silently ignored.
const fillVariant = Type.Object(
  { ...previewTabTargetParameters.properties, mode: Type.Literal('fill') },
  { additionalProperties: false },
)
const freeformVariant = Type.Object(
  {
    ...previewTabTargetParameters.properties,
    mode: Type.Literal('freeform'),
    width: viewportDimension,
    height: viewportDimension,
  },
  { additionalProperties: false },
)
const presetVariant = Type.Object(
  {
    ...previewTabTargetParameters.properties,
    mode: Type.Literal('preset'),
    preset,
    orientation: Type.Optional(orientation),
  },
  { additionalProperties: false },
)

/**
 * Provider-facing preview_resize schema: one object with a `mode` literal union and
 * every mode-specific field optional. A root-level anyOf is rejected by Amazon Bedrock
 * ("inputSchema.json.type must be one of the following: object"), flattened to no
 * properties by Pi's Anthropic serializer, and emitted as `{}` by some
 * OpenAI-completions providers. The per-mode required fields are enforced by
 * {@link toPreviewResizeInput} before the call is authorized.
 */
export const previewResizeParameters = Type.Object(
  {
    ...previewTabTargetParameters.properties,
    mode: Type.Union(
      [fillVariant, freeformVariant, presetVariant].map((variant) => variant.properties.mode),
      {
        description:
          'fill sizes the viewport to the panel; freeform requires width and height; preset requires preset and accepts orientation.',
      },
    ),
    width: Type.Optional(viewportDimension),
    height: Type.Optional(viewportDimension),
    preset: Type.Optional(preset),
    orientation: Type.Optional(orientation),
  },
  {
    description: `Viewport area may not exceed ${String(BROWSER_PREVIEW_VIEWPORT_MAX_AREA)} pixels.`,
  },
)

const VARIANTS_BY_MODE: Readonly<Record<string, TSchema>> = {
  fill: fillVariant,
  freeform: freeformVariant,
  preset: presetVariant,
}

function describeErrors(schema: TSchema, params: unknown) {
  return [...Errors(schema, params)]
    .map((error) => `${error.instancePath || 'arguments'}: ${error.message}`)
    .join('; ')
}

/**
 * Narrows the flat provider-facing arguments to the mode-discriminated service input,
 * throwing a model-readable error when the mode's required fields are missing or a
 * field from another mode is present.
 */
export function toPreviewResizeInput(params: unknown): BrowserPreviewAutomationResizeInput {
  if (!Check(previewResizeParameters, params)) {
    throw new Error(
      `Invalid preview_resize arguments: ${describeErrors(previewResizeParameters, params)}`,
    )
  }
  // Read before the variant guards: once every variant is ruled out TypeScript narrows
  // `params` to never, although a mode-mismatched field still reaches this point.
  const mode = params.mode
  if (Check(fillVariant, params)) return params
  if (Check(freeformVariant, params)) return params
  if (Check(presetVariant, params)) return params
  const variant = VARIANTS_BY_MODE[mode] ?? previewResizeParameters
  throw new Error(
    `Invalid preview_resize arguments for mode "${mode}": ${describeErrors(variant, params)}`,
  )
}
