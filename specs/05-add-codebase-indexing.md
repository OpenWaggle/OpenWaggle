# Add Codebase Indexing

**Priority:** 5 — Intelligence
**Depends on:** Nothing
**Blocks:** Nothing

---

## Problem

The agent wastes context tokens on file discovery. It does `glob` → `readFile` → wrong file → `glob` again. On large codebases, this loop eats 5-10 tool calls before finding the right code. A semantic search would cut this in half and make the agent dramatically smarter. This is what makes Cursor feel magical.

## What Exists

- `@xenova/transformers` 2.17.2 is already a dependency (used for Whisper voice transcription)
- `fast-glob` is used for file discovery
- The tool system can easily accept new tools via `defineOpenHiveTool`

## Implementation

### 1. Embedding model

Create `src/main/indexing/embedder.ts`:
- Use `@xenova/transformers` to load a sentence-transformers model (e.g., `all-MiniLM-L6-v2`, 22MB)
- Lazy-load the model on first index request
- Function: `embed(text: string): Promise<Float32Array>`
- Chunk files into ~500-token segments with overlap

### 2. Vector store

Create `src/main/indexing/store.ts`:
- Simple in-memory store: `Map<string, { path: string, startLine: number, endLine: number, embedding: Float32Array }>`
- Cosine similarity search
- Persist to disk: `{userData}/indexes/{projectPathHash}.json` (serialize embeddings as base64)
- No external dependency (SQLite/FAISS not needed at this scale)

### 3. Indexer

Create `src/main/indexing/indexer.ts`:
- On project open, check if index exists and is fresh (compare file mtimes)
- Index all text files (respect `.gitignore`, skip `node_modules`, binaries)
- Chunk strategy: split by function/class boundaries when possible, fall back to line-count chunks
- Background indexing with progress events to renderer
- Incremental re-index on file change (watch with `fs.watch` or `chokidar`)

### 4. Search tool

Create `src/main/tools/tools/search-codebase.ts`:
```ts
defineOpenHiveTool({
  name: 'searchCodebase',
  description: 'Semantic search across the project. Returns the most relevant code chunks for a natural language query.',
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().optional().default(10),
  }),
  execute: async (args, ctx) => { ... }
})
```
- Returns top-N chunks with file path, line range, and content
- Much faster than glob → readFile chains

### 5. IPC for index status

- `'index:status'` — returns `{ indexed: boolean, fileCount: number, lastUpdated: Date }`
- `'index:rebuild'` — force re-index
- `'index:progress'` — event with indexing progress

## Performance Considerations

- Embedding 1000 files (~500 chunks each) takes ~30s on M1 with MiniLM-L6
- Store in memory: ~50MB for a large codebase (10K chunks)
- Search latency: <10ms for cosine similarity over 10K vectors
- Index persisted to disk, loaded on project open

## Files to Create

- `src/main/indexing/embedder.ts`
- `src/main/indexing/store.ts`
- `src/main/indexing/indexer.ts`
- `src/main/tools/tools/search-codebase.ts`

## Files to Modify

- `src/main/tools/tools/` — register new tool in the core tools feature
- `src/shared/types/ipc.ts` — index status channels
- `src/main/agent/features/` — add indexing feature that provides the search tool
