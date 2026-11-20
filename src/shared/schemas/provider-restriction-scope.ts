import { Schema } from '@shared/schema'

/**
 * One **Provider restriction** scope (CONTEXT.md) as a patch or a stored row carries it: a
 * provider id mapped to its allowed/refused choice, with the reserved `only` key carrying the
 * provider id list that permits exactly those providers.
 *
 * It lives in its own module because both `validation.ts` and `settings-fields.ts` carry it, and
 * neither may pull the other's module graph into a bundle: reaching it through `settings-fields.ts`
 * put that module's whole schema graph into the renderer's initial chunk and into the extension
 * frame bootstrap (`performance/perf-budgets.json`).
 */
export const providerRestrictionScopeSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Union(Schema.Boolean, Schema.Array(Schema.String)),
})
