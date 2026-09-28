import { BROWSER_PREVIEW_LIMITS } from '@shared/types/browser-preview'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import { Type } from 'typebox'

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

export const previewAppearanceParameters = Type.Object({
  ...previewTabTargetParameters.properties,
  colorScheme: Type.Union([Type.Literal('system'), Type.Literal('light'), Type.Literal('dark')]),
})
