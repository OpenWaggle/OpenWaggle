/**
 * The version of how a Pi entry becomes a Session node (`projectPiEntry` and everything it calls).
 *
 * A Run keeps the entries its Session's last projection stored instead of projecting them again
 * (D6), which is only right while the stored rows are what this code would produce. Bump this
 * whenever an entry's projected `kind`, `role`, `contentJson` or `metadataJson` changes, so every
 * Session's next projection reads every entry again and repairs its stored rows, as every Run did
 * before D6.
 */
export const PI_ENTRY_PROJECTION_VERSION = 1
