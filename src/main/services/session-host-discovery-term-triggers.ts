export const SESSION_DISCOVERY_TERM_TRIGGER_NAMES = [
  'session_discovery_term_postings_insert',
  'session_discovery_term_postings_delete',
  'session_discovery_term_mapping_insert',
] as const

/**
 * The mapping owns these postings, including replacement and Session deletion. SQLite serializes
 * writers, so the staging FTS contains exactly one changed discovery document inside the mutation.
 * Never replace it with a live-corpus vocabulary filtered by doc: that filter scans every term.
 */
export const SESSION_DISCOVERY_TERM_TRIGGER_SCHEMA_STATEMENTS = [
  `
  CREATE TRIGGER session_discovery_term_postings_insert
  AFTER INSERT ON session_discovery_term_postings BEGIN
    INSERT INTO session_discovery_term_signatures (
      term, initial_frequency, preview_frequency, token_count, representative_rowid, member_count
    ) VALUES (
      new.term, new.initial_frequency, new.preview_frequency, new.token_count, new.search_rowid, 1
    )
    ON CONFLICT(term, initial_frequency, preview_frequency, token_count)
    DO UPDATE SET member_count = member_count + 1;
  END
  `,
  `
  CREATE TRIGGER session_discovery_term_postings_delete
  AFTER DELETE ON session_discovery_term_postings BEGIN
    UPDATE session_discovery_term_signatures
    SET member_count = member_count - 1,
      representative_rowid = CASE WHEN representative_rowid = old.search_rowid THEN
        COALESCE((
          SELECT search_rowid FROM session_discovery_term_postings
          WHERE term = old.term AND initial_frequency = old.initial_frequency
            AND preview_frequency = old.preview_frequency AND token_count = old.token_count
          LIMIT 1
        ), old.search_rowid)
        ELSE representative_rowid END
    WHERE term = old.term AND initial_frequency = old.initial_frequency
      AND preview_frequency = old.preview_frequency AND token_count = old.token_count;
    DELETE FROM session_discovery_term_signatures
    WHERE term = old.term AND initial_frequency = old.initial_frequency
      AND preview_frequency = old.preview_frequency AND token_count = old.token_count
      AND member_count = 0;
  END
  `,
  `
  CREATE TRIGGER session_discovery_term_mapping_insert
  AFTER INSERT ON session_discovery_search_rows BEGIN
    INSERT INTO session_discovery_term_stage (rowid, initial_objective, current_preview)
    VALUES (1, new.initial_objective, new.current_preview);
    INSERT INTO session_discovery_term_postings (
      session_id, term, search_rowid, initial_frequency, preview_frequency, token_count
    )
    SELECT new.session_id, term, new.search_rowid,
      SUM(col = 'initial_objective'), SUM(col = 'current_preview'),
      (SELECT COUNT(*) FROM session_discovery_term_stage_vocabulary)
    FROM session_discovery_term_stage_vocabulary
    GROUP BY term;
    DELETE FROM session_discovery_term_stage WHERE rowid = 1;
  END
  `,
] as const
