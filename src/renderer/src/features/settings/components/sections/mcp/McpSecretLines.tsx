import { mcpCountWords } from './mcp-count-words'

const SUBJECT_WORDS = {
  one: { reads: 'It reads', uses: 'It uses', using: 'the server' },
  many: { reads: 'The imported servers read', uses: 'They use', using: 'them' },
} as const

type McpSecretSubject = keyof typeof SUBJECT_WORDS

function MissingSecretsLine({
  missing,
  subject,
}: {
  readonly missing: readonly string[]
  readonly subject: McpSecretSubject
}) {
  const words = mcpCountWords(missing.length)
  const subjectWords = SUBJECT_WORDS[subject]
  return (
    <p className="text-warning">
      {`${subjectWords.reads} the secret${words.plural} ${missing.join(', ')}. Add ${words.object} under Secrets before using ${subjectWords.using}.`}
    </p>
  )
}

function ExistingSecretsLine({
  existingSecrets,
  subject,
}: {
  readonly existingSecrets: readonly string[]
  readonly subject: McpSecretSubject
}) {
  const words = mcpCountWords(existingSecrets.length)
  return (
    <p>
      {`${SUBJECT_WORDS[subject].uses} the secret${words.plural} ${existingSecrets.join(', ')}, which already ${words.exists} under Secrets; replace ${words.object} there if ${words.holds} another value.`}
    </p>
  )
}

/**
 * What a saved server reads from the vault: the secrets to add before using it, and those that
 * already exist and would be shared. `subject` is "one" for a Registry install, "many" for an
 * import that may have saved several servers.
 */
export function McpSecretLines({
  secrets,
  existingSecrets,
  subject,
}: {
  readonly secrets: readonly string[]
  readonly existingSecrets: readonly string[]
  readonly subject: McpSecretSubject
}) {
  const stored = new Set(existingSecrets)
  const missing = secrets.filter((secret) => !stored.has(secret))
  return (
    <>
      {missing.length > 0 ? <MissingSecretsLine missing={missing} subject={subject} /> : null}
      {existingSecrets.length > 0 ? (
        <ExistingSecretsLine existingSecrets={existingSecrets} subject={subject} />
      ) : null}
    </>
  )
}
