import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

interface LegacyImageRow {
  readonly id: string
  readonly session_id: string
  readonly canonical_key: string
  readonly kind: string
  readonly title: string
  readonly mime_type: string | null
  readonly locator: string | null
  readonly managed_path: string | null
  readonly available: number
  readonly created_at: number
  readonly updated_at: number
}

function normalizedHttpUrl(row: LegacyImageRow) {
  const candidates = [row.locator, row.canonical_key.slice('url:'.length)]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href
    } catch {
      // Try the other persisted representation before treating the row as malformed.
    }
  }
  return null
}

function preserveLegacyImage(
  sql: SqlClient.SqlClient,
  source: LegacyImageRow,
  normalizedUrl: string | null,
) {
  const canonicalKey = `legacy-image:${source.id}`
  return sql`
    UPDATE session_resources
    SET canonical_key = ${canonicalKey},
        locator = ${normalizedUrl ?? source.locator},
        updated_at = ${source.updated_at}
    WHERE id = ${source.id}
  `.pipe(Effect.asVoid)
}

function mergeLegacyImage(
  sql: SqlClient.SqlClient,
  source: LegacyImageRow,
  target: LegacyImageRow,
  normalizedUrl: string,
) {
  const distinctManagedCopies =
    source.managed_path !== null &&
    target.managed_path !== null &&
    source.managed_path !== target.managed_path
  if (target.kind !== 'image' || distinctManagedCopies) {
    // Both managed paths may be live. Keep both public resource handles and files rather than
    // silently orphaning one; only move the legacy row out of the generic URL namespace.
    return preserveLegacyImage(sql, source, normalizedUrl)
  }

  const title = source.updated_at > target.updated_at ? source.title : target.title
  const mimeType = target.mime_type ?? source.mime_type
  const managedPath = target.managed_path ?? source.managed_path
  const available = Math.max(source.available, target.available)
  const createdAt = Math.min(source.created_at, target.created_at)
  const updatedAt = Math.max(source.updated_at, target.updated_at)

  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_resources
      SET title = ${title},
          mime_type = ${mimeType},
          locator = ${normalizedUrl},
          managed_path = ${managedPath},
          available = ${available},
          created_at = ${createdAt},
          updated_at = ${updatedAt}
      WHERE id = ${target.id}
    `
    yield* sql`
      UPDATE session_resource_occurrences
      SET resource_id = ${target.id}
      WHERE resource_id = ${source.id}
    `
    yield* sql`DELETE FROM session_resources WHERE id = ${source.id}`
  })
}

export function runSessionResourceIdentityIsolationMigration(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const legacyImages = yield* sql<LegacyImageRow>`
      SELECT
        id, session_id, canonical_key, kind, title, mime_type, locator,
        managed_path, available, created_at, updated_at
      FROM session_resources
      WHERE kind = 'image'
        AND lower(canonical_key) LIKE 'url:http%'
      ORDER BY created_at, id
    `

    for (const source of legacyImages) {
      const normalizedUrl = normalizedHttpUrl(source)
      if (!normalizedUrl) {
        yield* preserveLegacyImage(sql, source, null)
        continue
      }

      const canonicalKey = `image-url:${normalizedUrl}`
      const targets = yield* sql<LegacyImageRow>`
        SELECT
          id, session_id, canonical_key, kind, title, mime_type, locator,
          managed_path, available, created_at, updated_at
        FROM session_resources
        WHERE session_id = ${source.session_id}
          AND canonical_key = ${canonicalKey}
        LIMIT 1
      `
      const target = targets[0]
      if (target) {
        yield* mergeLegacyImage(sql, source, target, normalizedUrl)
        continue
      }

      // Preserve the stable public resource id and any managed file when no merge is needed.
      yield* sql`
        UPDATE session_resources
        SET canonical_key = ${canonicalKey},
            locator = ${normalizedUrl}
        WHERE id = ${source.id}
      `
    }
  })
}

export const SESSION_RESOURCE_IDENTITY_ISOLATION_MIGRATION_STATEMENTS = [
  `
  DROP TABLE IF EXISTS temp.session_resource_attachment_identity_migration
  `,
  `
  CREATE TEMP TABLE session_resource_attachment_identity_migration AS
  SELECT
    occurrence.id AS occurrence_id,
    source.id AS source_id,
    source.session_id AS session_id,
    'unavailable-attachment:' || occurrence.id AS target_key,
    COALESCE(
      (
        SELECT target.id
        FROM session_resources AS target
        WHERE target.session_id = source.session_id
          AND target.canonical_key = 'unavailable-attachment:' || occurrence.id
        LIMIT 1
      ),
      'legacy-unavailable-' || lower(hex(randomblob(16)))
    ) AS target_id,
    source.kind AS kind,
    source.title AS title,
    source.mime_type AS mime_type,
    source.locator AS locator,
    source.created_at AS created_at,
    source.updated_at AS updated_at
  FROM session_resources AS source
  INNER JOIN session_resource_occurrences AS occurrence
    ON occurrence.resource_id = source.id
  WHERE source.canonical_key LIKE 'file:%'
    AND source.available = 0
    AND source.managed_path IS NULL
    AND (
      SELECT COUNT(*)
      FROM session_resource_occurrences AS sibling
      WHERE sibling.resource_id = source.id
    ) > 1
  `,
  `
  INSERT OR IGNORE INTO session_resources (
    id, session_id, canonical_key, kind, title, mime_type, locator,
    managed_path, available, created_at, updated_at
  )
  SELECT
    target_id, session_id, target_key, kind, title, mime_type, locator,
    NULL, 0, created_at, updated_at
  FROM session_resource_attachment_identity_migration
  `,
  `
  UPDATE session_resource_occurrences
  SET resource_id = (
    SELECT migration.target_id
    FROM session_resource_attachment_identity_migration AS migration
    WHERE migration.occurrence_id = session_resource_occurrences.id
    LIMIT 1
  )
  WHERE id IN (
    SELECT occurrence_id FROM session_resource_attachment_identity_migration
  )
  `,
  `
  DELETE FROM session_resources
  WHERE id IN (
    SELECT source_id FROM session_resource_attachment_identity_migration
  )
  `,
  `
  DROP TABLE session_resource_attachment_identity_migration
  `,
] as const
