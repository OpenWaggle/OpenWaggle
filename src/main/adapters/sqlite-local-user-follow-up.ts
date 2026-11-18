/**
 * SQL: the Follow-up row `alias` was sent by the local desktop user (`isLocalUserCallerId` on its
 * intent's caller), so the Host starts it as the person's work.
 */
export function localUserFollowUpSql(alias: string) {
  const caller = `json_extract(${alias}.intent_json, '$.callerId')`
  return `(${caller} IN ('local-user', 'gui:local-user') OR ${caller} LIKE 'local-user:%')`
}
