import { uncheckedFields } from '@shared/utils/object-shape'

/** Where a hive-tool `report` goes. */
export interface HiveToolReportTarget {
  readonly type: string
  readonly sessionId: string
  readonly sessionIds: readonly string[]
}

/** The hive-tool arguments a transcript row reads; the model wrote them, so each is unchecked. */
export interface HiveToolArgs {
  readonly action: string
  readonly sessionId: string
  readonly target: HiveToolReportTarget
}

/** Session Control's answer to a spawn or launch: `{ response: { outcome: { sessionId } } }`. */
export interface HiveToolCreatedResult {
  readonly response: { readonly outcome: { readonly sessionId: string } }
}

export function hiveToolArgFields(args: unknown) {
  return uncheckedFields<HiveToolArgs>(args)
}

export function hiveToolTargetFields(args: unknown) {
  return uncheckedFields<HiveToolReportTarget>(hiveToolArgFields(args).target)
}

export function hiveToolCreatedSessionId(body: unknown): unknown {
  const { response } = uncheckedFields<HiveToolCreatedResult>(body)
  const { outcome } = uncheckedFields<HiveToolCreatedResult['response']>(response)
  return uncheckedFields<HiveToolCreatedResult['response']['outcome']>(outcome).sessionId
}
