/** How archiving its own Session behaves, for an agent whose grant permits archive. */
export const SELF_ARCHIVE_GUIDELINE =
  'archive on your own Session answers session-archive-deferred and archives it once this Run completes, so you can still write your final reply after the call. A Follow-up or another Run, a Worker update that arrives before this Run ends, an unarchive or a pin, or this Run failing or being stopped cancels it. A steer into this Run does not; unarchive if the user now wants to keep the Session. Archiving a Heartbeat’s Session turns that Heartbeat off.'
