# Edit Rows Show Their Diff On Demand

Status: accepted. Supersedes the "One diff surface" clause of ADR 0034; the rest of ADR 0034 stands.

ADR 0034 removed the inline diff from tool-call blocks, so expanding an edit row showed only the raw `edits[]` arguments and a "Successfully replaced N block(s)" line: a reader could see that a file changed and by how much, but not what changed without opening the Turn diff view. An edit row now renders its own file diff when the reader expands it, following Codex: rows stay collapsed by default, and an expanded diff is capped at 15rem and scrolls, so settled turns fold exactly as before and the transcript gains no diff fragments a reader did not ask for. The Turn diff view remains the only surface for a turn's aggregated changes.
