import * as Effect from 'effect/Effect'
import { makeEffectReadWriteGate } from '../utils/effect-read-write-gate'

const managementGate = Effect.runSync(makeEffectReadWriteGate())

/** Keep a management snapshot valid from config read through its final runtime operation. */
export const withMcpManagementRead = managementGate.read

/** Make a config/vault mutation and its runtime reconciliation one indivisible transition. */
export const withMcpManagementWrite = managementGate.write
