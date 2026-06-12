import { Schema } from '@shared/schema'

export const nonEmptyStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0),
)

export const extensionInvokeAppScopeSchema = Schema.Struct({ kind: Schema.Literal('app') })

export const extensionInvokeProjectScopeSchema = Schema.Struct({
  kind: Schema.Literal('project'),
  projectPath: nonEmptyStringSchema,
})

export const extensionInvokeSessionScopeSchema = Schema.Struct({
  kind: Schema.Literal('session'),
  projectPath: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
})

export const extensionInvokeBranchScopeSchema = Schema.Struct({
  kind: Schema.Literal('branch'),
  projectPath: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  branchId: nonEmptyStringSchema,
})

export const extensionInvokeScopeSchema = Schema.Union(
  extensionInvokeAppScopeSchema,
  extensionInvokeProjectScopeSchema,
  extensionInvokeSessionScopeSchema,
  extensionInvokeBranchScopeSchema,
)
