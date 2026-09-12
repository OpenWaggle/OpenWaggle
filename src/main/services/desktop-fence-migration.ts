import {
  DESKTOP_FENCE_IDENTIFIER_LENGTH,
  DESKTOP_FENCE_SCOPE_LENGTH,
} from '@shared/schemas/desktop-fence'
import { DESKTOP_SERVICE_LIMITS } from '@shared/types/desktop-service'
import { SESSION_HOST_DESKTOP_FENCE_MIGRATION_ID } from './session-host-schema-identity'

export const DESKTOP_FENCE_MIGRATION = {
  id: SESSION_HOST_DESKTOP_FENCE_MIGRATION_ID,
  name: 'session-host-desktop-mutation-fences',
  statements: [
    `CREATE TABLE IF NOT EXISTS desktop_native_owner (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      gui_instance_id TEXT NOT NULL CHECK(length(gui_instance_id) BETWEEN 1 AND ${DESKTOP_FENCE_IDENTIFIER_LENGTH}),
      host_instance_id TEXT NOT NULL CHECK(length(host_instance_id) BETWEEN 1 AND ${DESKTOP_FENCE_IDENTIFIER_LENGTH}),
      state TEXT NOT NULL CHECK(state IN ('active', 'closed'))
    )`,
    `CREATE TABLE IF NOT EXISTS desktop_mutation_fences (
      token TEXT PRIMARY KEY NOT NULL CHECK(length(token) BETWEEN 1 AND ${DESKTOP_FENCE_IDENTIFIER_LENGTH}),
      host_instance_id TEXT NOT NULL CHECK(length(host_instance_id) BETWEEN 1 AND ${DESKTOP_FENCE_IDENTIFIER_LENGTH}),
      scope_kind TEXT NOT NULL CHECK(scope_kind IN ('owner', 'path')),
      scope_value TEXT NOT NULL CHECK(length(scope_value) BETWEEN 1 AND ${DESKTOP_FENCE_SCOPE_LENGTH}),
      state TEXT NOT NULL CHECK(state IN ('active', 'released'))
    )`,
    `CREATE TRIGGER IF NOT EXISTS desktop_mutation_fences_admission
      BEFORE INSERT ON desktop_mutation_fences
      WHEN (SELECT COUNT(*) FROM desktop_mutation_fences) >= ${DESKTOP_SERVICE_LIMITS.fenceRecords}
      BEGIN SELECT RAISE(ABORT, 'Desktop mutation fence capacity exhausted'); END`,
  ],
} as const
