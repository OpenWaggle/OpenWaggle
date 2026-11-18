import { Schema } from '@shared/schema'
import {
  normalizeSessionReportReference,
  type SessionReportReferenceKind,
} from '@shared/session-report-reference'
import type { HostSqliteDatabase } from './host-sqlite-database'
import { decodeCutoverRow } from './session-host-cutover-database'

interface ReferenceSource {
  readonly sessionId: string
  readonly title: string
  readonly agentDefinitionName?: string
}

const profileAgentDefinitionSchema = Schema.Struct({ agentDefinitionName: Schema.String })

const referenceSourceRowSchema = Schema.Struct({
  session_id: Schema.String,
  title: Schema.String,
  profile_json: Schema.String,
})

const referenceCatalogRowSchema = Schema.Struct({
  session_id: Schema.String,
  kind: Schema.String,
  normalized_reference: Schema.String,
})

function optionalAgentDefinitionName(profileJson: string) {
  const decoded: unknown = JSON.parse(profileJson)
  return decodeCutoverRow(profileAgentDefinitionSchema, decoded)?.agentDefinitionName
}

function referenceSources(database: HostSqliteDatabase) {
  const values: unknown = database
    .prepare(`
      SELECT sessions.id AS session_id, sessions.title,
        session_execution_profiles.profile_json
      FROM sessions
      JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      ORDER BY sessions.id
    `)
    .all()
  if (!Array.isArray(values)) throw new Error('Session report reference sources are invalid.')
  return values.map((value) => {
    const row = decodeCutoverRow(referenceSourceRowSchema, value)
    if (!row) throw new Error('Session report reference source is invalid.')
    const agentDefinitionName = optionalAgentDefinitionName(row.profile_json)
    return {
      sessionId: row.session_id,
      title: row.title,
      ...(agentDefinitionName ? { agentDefinitionName } : {}),
    }
  })
}

function expectedReferences(source: ReferenceSource) {
  const entries: readonly (readonly [SessionReportReferenceKind, string])[] = [
    ['session-id', source.sessionId],
    ['title', source.title],
    ...(source.agentDefinitionName
      ? ([['agent-definition', source.agentDefinitionName]] as const)
      : []),
  ]
  return entries
    .map(([kind, value]) => ({
      sessionId: source.sessionId,
      kind,
      normalizedReference: normalizeSessionReportReference(value),
    }))
    .filter((reference) => reference.normalizedReference.length > 0)
}

export function populateSessionReportReferenceCatalog(database: HostSqliteDatabase) {
  const insert = database.prepare(`
    INSERT INTO session_report_references (session_id, kind, normalized_reference)
    VALUES (?, ?, ?)
  `)
  for (const source of referenceSources(database)) {
    for (const reference of expectedReferences(source)) {
      insert.run(reference.sessionId, reference.kind, reference.normalizedReference)
    }
  }
}

export function validateSessionReportReferenceCatalog(database: HostSqliteDatabase) {
  const expected = referenceSources(database).flatMap(expectedReferences)
  const actual: unknown = database
    .prepare(`
      SELECT session_id, kind, normalized_reference
      FROM session_report_references
      ORDER BY session_id, kind
    `)
    .all()
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error('Session report reference catalog coverage is invalid.')
  }
  const actualByKey = new Map<string, string>()
  for (const value of actual) {
    const row = decodeCutoverRow(referenceCatalogRowSchema, value)
    if (!row) throw new Error('Session report reference catalog row is invalid.')
    actualByKey.set(`${row.session_id}\0${row.kind}`, row.normalized_reference)
  }
  for (const reference of expected) {
    if (
      actualByKey.get(`${reference.sessionId}\0${reference.kind}`) !== reference.normalizedReference
    ) {
      throw new Error('Session report reference catalog coverage is invalid.')
    }
  }
}
