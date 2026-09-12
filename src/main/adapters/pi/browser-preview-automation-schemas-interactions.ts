import { BROWSER_PREVIEW_LIMITS } from '@shared/types/browser-preview'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import { Type } from 'typebox'
import { previewTabTargetParameters } from './browser-preview-automation-schemas-core'

const MAX_LOCATOR_LENGTH = 4_096
const MAX_KEY_LENGTH = 64
const MAX_MODIFIERS = 4

const targetSelectorFields = {
  selector: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: MAX_LOCATOR_LENGTH,
      description: 'Legacy CSS selector.',
    }),
  ),
  locator: Type.Optional(
    Type.String({ minLength: 1, maxLength: MAX_LOCATOR_LENGTH, description: 'Semantic locator.' }),
  ),
}

const timeout = Type.Optional(
  Type.Integer({ minimum: 1, maximum: BROWSER_PREVIEW_AUTOMATION_LIMITS.MAX_TIMEOUT_MS }),
)

export const previewClickParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  ...targetSelectorFields,
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  timeoutMs: timeout,
})

export const previewTypeParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  ...targetSelectorFields,
  text: Type.String({ maxLength: BROWSER_PREVIEW_AUTOMATION_LIMITS.RESULT_BYTES }),
  clear: Type.Optional(Type.Boolean()),
  timeoutMs: timeout,
})

export const previewPressParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  key: Type.String({ minLength: 1, maxLength: MAX_KEY_LENGTH }),
  modifiers: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('Alt'),
        Type.Literal('Control'),
        Type.Literal('Meta'),
        Type.Literal('Shift'),
      ]),
      { maxItems: MAX_MODIFIERS, uniqueItems: true },
    ),
  ),
})

export const previewScrollParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  ...targetSelectorFields,
  deltaX: Type.Optional(Type.Number()),
  deltaY: Type.Optional(Type.Number()),
})

export const previewEvaluateParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  expression: Type.String({
    minLength: 1,
    maxLength: BROWSER_PREVIEW_AUTOMATION_LIMITS.EXPRESSION_LENGTH,
  }),
  awaitPromise: Type.Optional(Type.Boolean()),
  returnByValue: Type.Optional(Type.Boolean()),
})

export const previewWaitParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  ...targetSelectorFields,
  text: Type.Optional(Type.String({ minLength: 1, maxLength: BROWSER_PREVIEW_LIMITS.URL_LENGTH })),
  urlIncludes: Type.Optional(
    Type.String({ minLength: 1, maxLength: BROWSER_PREVIEW_LIMITS.URL_LENGTH }),
  ),
  timeoutMs: timeout,
})
