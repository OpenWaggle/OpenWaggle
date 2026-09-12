import { Type } from 'typebox'

const interactionResponse = Type.Union([
  Type.Object({
    kind: Type.Literal('confirm'),
    accepted: Type.Boolean(),
    scope: Type.Optional(
      Type.Union([Type.Literal('once'), Type.Literal('session'), Type.Literal('project')]),
    ),
  }),
  Type.Object({ kind: Type.Literal('select'), selected: Type.Union([Type.String(), Type.Null()]) }),
  Type.Object({ kind: Type.Literal('input'), value: Type.Union([Type.String(), Type.Null()]) }),
  Type.Object({ kind: Type.Literal('editor'), value: Type.Union([Type.String(), Type.Null()]) }),
  Type.Object({ kind: Type.Literal('notify'), acknowledged: Type.Literal(true) }),
  Type.Object({ kind: Type.Literal('custom'), value: Type.Unknown() }),
])

export const sessionsToolControlParameters = [
  Type.Object({
    action: Type.Literal('interrupt'),
    sessionId: Type.String(),
    expectedRunId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal('interrupt_descendants'),
    sessionId: Type.String(),
  }),
  Type.Object({
    action: Type.Union([Type.Literal('request_respond'), Type.Literal('approval_respond')]),
    sessionId: Type.String(),
    runId: Type.String(),
    interactionId: Type.String(),
    response: interactionResponse,
  }),
  Type.Object({
    action: Type.Literal('authorization_set'),
    sessionId: Type.String(),
    authorizationMode: Type.Union([
      Type.Literal('inherit'),
      Type.Literal('ask-for-approval'),
      Type.Literal('yolo'),
    ]),
  }),
] as const
