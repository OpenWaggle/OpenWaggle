import { MultilingualE5SessionEmbeddingModel } from '../src/main/adapters/multilingual-e5-session-embedding-model'
import { SessionFlatVectorIndex } from '../src/main/adapters/session-flat-vector-index'

const TOP_MATCH_COUNT = 3
const JSON_INDENT_SPACES = 2

const documents = [
  ['migration', 'Implement atomic database cutover and recovery backup'],
  ['auth', 'Add OAuth provider login and credential refresh'],
  ['ui', 'Diseñar navegación lateral para sesiones hijas'],
  ['tests', 'Repair flaky integration tests for the queue'],
  ['git', 'Resolve worktree merge conflicts safely'],
  ['search', 'Build multilingual semantic vector search'],
] as const

const queries = [
  ['recuperación de migración de base de datos', 'migration'],
  ['child session sidebar navigation', 'ui'],
  ['recherche vectorielle multilingue', 'search'],
] as const

async function main() {
  const model = new MultilingualE5SessionEmbeddingModel()
  const index = new SessionFlatVectorIndex()
  let startedAt = performance.now()
  const vectors = await model.embedPassages(documents.map(([, document]) => document))
  const passageBatchMs = performance.now() - startedAt
  index.replace(
    documents.map(([sessionId], index) => ({ sessionId, vector: vectors[index] ?? new Float32Array() })),
  )
  const results = []
  for (const [query, expected] of queries) {
    startedAt = performance.now()
    const [vector] = await model.embedQueries([query])
    if (!vector) throw new Error('Embedding query returned no vector.')
    const matches = index.search(vector, TOP_MATCH_COUNT)
    results.push({
      query,
      expected,
      queryMs: performance.now() - startedAt,
      matches,
      passed: matches[0]?.sessionId === expected,
    })
  }
  const passed = results.every((result) => result.passed)
  process.stdout.write(
    `${JSON.stringify(
      {
        model: model.metadata,
        passageCount: documents.length,
        passageBatchMs,
        results,
        passed,
      },
      null,
      JSON_INDENT_SPACES,
    )}\n`,
  )
  if (!passed) process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
