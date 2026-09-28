import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
} from '@shared/browser-preview-viewports'
import type { BrowserPreviewAutomationResizeInput } from '@shared/types/browser-preview-automation'
import {
  BROWSER_PREVIEW_VIEWPORT_PRESET_IDS,
  type BrowserPreviewViewportPresetId,
} from '@shared/types/browser-preview-controls'
import { type Static, type TObject, Type } from 'typebox'
import { Check, Errors } from 'typebox/value'
import { previewTabTargetParameters } from './browser-preview-automation-schemas-core'
import { formatTypeBoxErrors } from './typebox-errors'

const VIEWPORT_LIMITS = `Viewport area may not exceed ${String(BROWSER_PREVIEW_VIEWPORT_MAX_AREA)} pixels.`

const viewportDimension = Type.Integer({
  minimum: BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
  maximum: BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  description: `Freeform mode only. ${VIEWPORT_LIMITS}`,
})

// The `{ type: 'string', enum }` shape Pi's StringEnum emits, which every provider accepts.
// Built locally so the schema type comes from OpenWaggle's TypeBox, not Pi's copy.
const preset = Type.Unsafe<BrowserPreviewViewportPresetId>({
  type: 'string',
  enum: [...BROWSER_PREVIEW_VIEWPORT_PRESET_IDS],
  description: 'Preset mode only.',
})

const orientation = Type.Union([Type.Literal('portrait'), Type.Literal('landscape')], {
  description: 'Preset mode only. Defaults to the preset orientation.',
})

// Per-mode contracts. They are closed, like the Session Host wire schema, so a field that
// belongs to another mode is reported to the model instead of being silently ignored.
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
 * {@link toPreviewResizeInput} before the call is authorized. Limits live on the
 * properties because Pi's Anthropic serializer drops root-level descriptions.
 */
export const previewResizeParameters = Type.Object(
  {
    ...previewTabTargetParameters.properties,
    // A tuple literal, not a mapped array: TypeBox infers never from a widened array.
    mode: Type.Union(
      [fillVariant.properties.mode, freeformVariant.properties.mode, presetVariant.properties.mode],
      {
        description:
          'fill sizes the viewport to the panel and takes no size fields; freeform requires width and height; preset requires preset and accepts orientation. tabId is accepted in every mode; fields from another mode are rejected.',
      },
    ),
    width: Type.Optional(viewportDimension),
    height: Type.Optional(viewportDimension),
    preset: Type.Optional(preset),
    orientation: Type.Optional(orientation),
  },
  { description: VIEWPORT_LIMITS },
)

type PreviewResizeMode = Static<typeof previewResizeParameters>['mode']

const VARIANTS_BY_MODE = {
  fill: fillVariant,
  freeform: freeformVariant,
  preset: presetVariant,
} satisfies Record<PreviewResizeMode, TObject>

function describeModeErrors(mode: PreviewResizeMode, params: Readonly<Record<string, unknown>>) {
  const variant = VARIANTS_BY_MODE[mode]
  const accepted = new Set(Object.keys(variant.properties))
  const unexpected = Object.keys(params).filter((field) => !accepted.has(field))
  const unexpectedPaths = new Set(unexpected.map((field) => `/${field}`))
  const remaining = Errors(variant, params).filter(
    (error) => error.keyword !== 'additionalProperties' && !unexpectedPaths.has(error.instancePath),
  )
  return [
    ...(unexpected.length > 0
      ? [`${unexpected.join(', ')} ${unexpected.length === 1 ? 'is' : 'are'} not accepted`]
      : []),
    ...(remaining.length > 0 ? [formatTypeBoxErrors(remaining)] : []),
  ].join('; ')
}

/**
 * Narrows the flat provider-facing arguments to the mode-discriminated service input,
 * throwing a model-readable error when the mode's required fields are missing or a
 * field from another mode is present.
 */
export function toPreviewResizeInput(params: unknown): BrowserPreviewAutomationResizeInput {
  if (!Check(previewResizeParameters, params)) {
    throw new Error(
      `Invalid preview_resize arguments: ${formatTypeBoxErrors(Errors(previewResizeParameters, params))}`,
    )
  }
  if (Check(fillVariant, params)) return params
  if (Check(freeformVariant, params)) return params
  if (Check(presetVariant, params)) return params
  throw new Error(
    `Invalid preview_resize arguments for mode "${params.mode}": ${describeModeErrors(params.mode, params)}`,
  )
}
