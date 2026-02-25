# 29 — Codebase Indexing

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None
**Origin:** Spec 05

---

## Problem

The agent wastes context tokens on file discovery. It does `glob` → `readFile` → wrong file → `glob` again. On large codebases, this loop eats 5-10 tool calls. A semantic search would cut this in half and make the agent dramatically smarter.

## What Exists

- `@xenova/transformers` 2.17.2 is already a dependency (used for Whisper)
- `fast-glob` is used for file discovery
- The tool system can easily accept new tools via `defineOpenWaggleTool`

## Implementation

### 1. Embedding model

Create `src/main/indexing/embedder.ts`:
- Use `@xenova/transformers` with `all-MiniLM-L6-v2` (22MB)
- Lazy-load on first index request
- Chunk files into ~500-token segments with overlap

### 2. Vector store

Create `src/main/indexing/store.ts`:
- In-memory: `Map<string, { path, startLine, endLine, embedding }>`
- Cosine similarity search
- Persist to disk: `{userData}/indexes/{projectPathHash}.json`

### 3. Indexer

Create `src/main/indexing/indexer.ts`:
- On project open, check if index exists and is fresh
- Index text files (respect `.gitignore`, skip `node_modules`)
- Background indexing with progress events
- Incremental re-index on file change

### 4. Search tool

Create `src/main/tools/tools/search-codebase.ts`:
- Returns top-N chunks with file path, line range, and content

### 5. IPC for index status

- `'index:status'` — indexed status, file count, last updated
- `'index:rebuild'` — force re-index
- `'index:progress'` — indexing progress event

## Performance

- Embedding 1000 files: ~30s on M1
- Memory: ~50MB for a large codebase
- Search latency: <10ms

## Files to Create

- `src/main/indexing/embedder.ts`
- `src/main/indexing/store.ts`
- `src/main/indexing/indexer.ts`
- `src/main/tools/tools/search-codebase.ts`

## Files to Modify

- `src/main/tools/tools/` — register new tool
- `src/shared/types/ipc.ts` — index status channels
- `src/main/agent/features/` — add indexing feature
