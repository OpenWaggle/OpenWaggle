import { DESKTOP_FENCE_MIGRATION } from './desktop-fence-migration'
import { SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION } from './session-host-browser-attachment-migration'
import { SESSION_HOST_DISCOVERY_TERM_MIGRATION } from './session-host-discovery-term-migration'
import { SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION } from './session-host-export-selected-path-migration'
import {
  SESSION_HOST_DATABASE_MIGRATION,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION,
} from './session-host-migration'
import { SESSION_HOST_NODE_DELETE_MIGRATION } from './session-host-node-delete-migration'
import { SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION } from './session-host-transcript-term-migration'

/** Ordered Host migrations follow the released application migrations, whose IDs never move. */
export const SESSION_HOST_APP_MIGRATIONS = [
  SESSION_HOST_DATABASE_MIGRATION,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION,
  SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION,
  SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION,
  SESSION_HOST_NODE_DELETE_MIGRATION,
  SESSION_HOST_DISCOVERY_TERM_MIGRATION,
  DESKTOP_FENCE_MIGRATION,
  SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION,
] as const
