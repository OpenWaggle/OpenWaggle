import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { updateDelegationAmendment } from './sqlite-session-delegation-amendments'
import { updateDelegationClaims } from './sqlite-session-delegation-claims'
import { acknowledgeDelegationConflict } from './sqlite-session-delegation-conflicts'
import { updateDelegationDependency } from './sqlite-session-delegation-dependencies'
import type {
  DelegationContractRow,
  ExecuteDelegationInput,
} from './sqlite-session-delegation-support'
import { recordDelegationVerification } from './sqlite-session-delegation-verification'

export function updateDelegationCoordination(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const claim = yield* updateDelegationClaims(sql, input, contract)
    if (claim) return claim
    const conflict = yield* acknowledgeDelegationConflict(sql, input, contract)
    if (conflict) return conflict
    const dependency = yield* updateDelegationDependency(sql, input, contract)
    if (dependency) return dependency
    const amendment = yield* updateDelegationAmendment(sql, input, contract)
    if (amendment) return amendment
    return yield* recordDelegationVerification(sql, input, contract)
  })
}
