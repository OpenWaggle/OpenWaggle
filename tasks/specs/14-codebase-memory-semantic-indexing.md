# Spec 14 — Codebase Memory & Semantic Indexing

**Goal**: Build a local knowledge graph that passively indexes the codebase as the agent works, combining embeddings, AST structure, and git history into unified context. First session the agent knows nothing; 50th session it understands the architecture like a senior dev who's been on the team for a year.

**Status**: Planned

**Depends on**: None

**Note**: This evolves the existing Spec 05 (Codebase Indexing) from a basic search feature into a comprehensive memory system.

---

## The Gap

| Tool | Approach | What's Missing |
|------|----------|---------------|
| Cursor | Merkle tree + server-side embeddings (Turbopuffer) | No offline, no AST, no git history, no progressive memory |
| Sourcegraph Cody | Code graph + enterprise search | Server-dependent, no local, Enterprise-only |
| Continue.dev | Tree-sitter + local MiniLM + Vectra | Good baseline but no relationship graph, no passive indexing |
| Windsurf (Cascade) | Real-time action tracking | Ephemeral — within-session only, no persistence |
| Augment Code | 200K-token context, dependency graphs | Proprietary, server-side, unverifiable |
| Claude Code | CLAUDE.md manual memory | Captures intent/decisions but requires human authoring |
| Roo Code | Vector DB + Memory Bank MCP | Closest overall, but MCP-based (not integrated) |

**The novel combination**: Local embeddings (no server) + AST graph (tree-sitter) + git history + passive indexing (builds as agent works) + persistent architectural memory (LLM-generated notes survive across sessions).

---

## Architecture

### Knowledge Graph Layers

```
+-------------------------------------------+
|           Semantic Knowledge Graph         |
|                                           |
|  Nodes:                                   |
|  - CodeEntity (function, class, module)   |
|  - File                                   |
|  - Commit                                 |
|  - ArchitecturalNote (LLM-generated)      |
|                                           |
|  Edges:                                   |
|  - CALLS / CALLED_BY                      |
|  - IMPORTS / EXPORTS                      |
|  - DEFINED_IN (file)                      |
|  - MODIFIED_BY (commit)                   |
|  - DEPENDS_ON (config, env var)           |
|                                           |
|  Layers:                                  |
|  - Vector embeddings (semantic search)    |
|  - AST structure (exact relationships)    |
|  - Git history (temporal context)         |
|  - Agent memory (decisions, patterns)     |
+-------------------------------------------+
```

### Storage

```
{userData}/knowledge/{project-hash}/
  embeddings.sqlite   # vectors + metadata (hnswsqlite)
  graph.sqlite        # AST relationships, entities
  memory.sqlite       # agent notes, decisions, patterns
{userData}/knowledge/models/
  model.onnx          # shared embedding model (nomic-embed-text or MiniLM)
```

SQLite for everything: ACID transactions, single-file portability, WAL mode for concurrent reads.

### Embedding Model Options

| Model | Dimensions | Size | Speed | Quality |
|-------|-----------|------|-------|---------|
| all-MiniLM-L6-v2 | 384 | ~23MB | ~14.7ms/1K tokens | Good baseline (Continue.dev default) |
| nomic-embed-text-v1.5 | 768 (512 Matryoshka) | ~137MB | Moderate | Best open-source quality |

Recommendation: Start with **all-MiniLM-L6-v2** for speed, offer **nomic-embed-text-v1.5** as a quality option in settings.

---

## Implementation

### Phase 1: Passive Indexing Foundation

- [ ] Create `src/main/knowledge/indexer.ts`
  - Background worker that indexes files as they are read by the agent
  - When `readFile` tool reads a file → parse with tree-sitter → chunk → embed → store
  - Incremental: track file content hashes, only re-index changed chunks
  - Throttled: batch embeddings, max 10 files/second to avoid CPU spikes
  - Runs in worker thread to not block main process
- [ ] Create `src/main/knowledge/chunker.ts`
  - Tree-sitter-based chunking: split files into semantic blocks (functions, classes, type definitions)
  - If file fits in one chunk (< 500 tokens), use whole file
  - Each chunk has: content, file path, line range, entity type (function/class/type/module)
  - Content hash for dedup
- [ ] Create `src/main/knowledge/embedder.ts`
  - Uses `@xenova/transformers` (already in deps) with ONNX runtime
  - Model: all-MiniLM-L6-v2 (384d) for v1
  - Batch embedding: process multiple chunks per inference call
  - Model loaded once, kept in memory
- [ ] Create `src/main/knowledge/vector-store.ts`
  - SQLite-backed vector storage
  - For < 50K chunks: brute-force cosine similarity (Vectra-style, pure JS)
  - For > 50K chunks: migrate to hnswsqlite (HNSW approximate nearest neighbor)
  - `query(embedding, topK)` → ranked results with file path + line range
- [ ] Create `src/main/knowledge/graph-store.ts`
  - SQLite-backed relationship store
  - Nodes: code entities with metadata
  - Edges: calls, imports, exports, defined_in
  - Graph traversal queries: "what calls this function?", "what does this module export?"

### Phase 2: Agent Tools

- [ ] Create `src/main/tools/tools/codebase-search.ts`
  - Tool name: `codebaseSearch`
  - Args: `{ query: string, scope?: 'semantic' | 'structural' | 'both', topK?: number }`
  - Semantic search: embed query → vector similarity → return matching chunks
  - Structural search: graph traversal → "what calls X?", "what imports Y?"
  - Combined: semantic results enriched with structural context
- [ ] Create `src/main/tools/tools/codebase-understand.ts`
  - Tool name: `codebaseUnderstand`
  - Args: `{ entity: string }` (function name, module path, etc.)
  - Returns: entity definition + callers + callees + recent git changes + any agent notes
  - The "explain this" tool that combines all knowledge layers

### Phase 3: Progressive Background Indexing

- [ ] Add full-project background indexing on first open
  - Priority 1: Files the user opens or agent reads (passive, immediate)
  - Priority 2: Files imported by priority-1 files (structural neighbors)
  - Priority 3: All remaining files (idle-time sweep)
  - Progress indicator in UI (non-blocking)
- [ ] Watch for file changes via `chokidar` / `fs.watch`
  - On file change: re-parse with tree-sitter, diff chunk hashes, re-embed only changed chunks
  - On branch switch: mark stale entries, re-index incrementally
- [ ] Index invalidation
  - Track HEAD SHA — on new commits, re-index only affected files
  - On branch switch, invalidate all entries and re-index

### Phase 4: Architectural Memory

- [ ] Post-conversation synthesis
  - After each agent conversation, run a lightweight LLM pass:
  - "Based on this conversation, what architectural facts did you learn about the codebase?"
  - Store as ArchitecturalNote nodes in the graph
  - Only for conversations where the agent explored code (not simple Q&A)
- [ ] Memory retrieval in system prompt
  - On new conversation: query relevant architectural notes
  - Inject top-5 most relevant notes into context
  - Result: agent "remembers" past discoveries
- [ ] Memory decay
  - Notes accessed frequently get higher relevance scores
  - Notes not accessed in 30 days get demoted
  - User can pin/unpin notes in settings

### Phase 5: Settings & UI

- [ ] Index status panel in settings
  - Files indexed / total files
  - Index size on disk
  - Last indexed timestamp
  - Re-index button
  - Model selection (MiniLM vs nomic-embed)
- [ ] Knowledge explorer (future, low priority)
  - Visual graph of module relationships
  - Search interface for architectural notes

---

## Resource Budget (10K file codebase)

| Component | Disk | Memory (peak) | Memory (idle) |
|-----------|------|---------------|---------------|
| Embedding model (MiniLM) | ~23MB | ~100MB | ~100MB |
| Vectors (30K chunks, 384d) | ~60MB | ~80MB | ~20MB |
| AST graph + metadata | ~50MB | ~30MB | ~10MB |
| Agent memory notes | ~5MB | ~5MB | ~5MB |
| **Total** | **~140MB** | **~215MB** | **~135MB** |

### Indexing Speed

- Tree-sitter parsing: ~1ms/file (10K files in ~10s)
- Embedding (MiniLM, batched): ~2-3 minutes for full index
- Incremental re-index (single file): < 100ms
- Semantic query: < 5ms
- Graph traversal: < 10ms

---

## Passive Indexing: What Makes This Different

The key insight: **index as a byproduct of agent work**, not as a separate "index my codebase" step.

| Session | Agent Knowledge |
|---------|----------------|
| 1 | Knows nothing. Reads files via tools, indexes them passively. |
| 5 | Knows the files it's visited. Can search semantically within explored code. |
| 10 | Knows project structure, key modules, naming conventions. Synthesized notes persist. |
| 25 | Deep module relationships mapped. Knows why decisions were made (from past conversations). |
| 50 | Institutional knowledge: architecture patterns, technical debt locations, team conventions. |

---

## Files to Create

- `src/main/knowledge/indexer.ts` — background indexing orchestrator
- `src/main/knowledge/chunker.ts` — tree-sitter-based code chunking
- `src/main/knowledge/embedder.ts` — local embedding via @xenova/transformers
- `src/main/knowledge/vector-store.ts` — SQLite vector storage + similarity search
- `src/main/knowledge/graph-store.ts` — SQLite relationship graph
- `src/main/knowledge/memory-store.ts` — architectural notes persistence
- `src/main/tools/tools/codebase-search.ts` — semantic + structural search tool
- `src/main/tools/tools/codebase-understand.ts` — entity understanding tool

## Files to Modify

- `src/main/index.ts` — initialize indexer on app start
- `src/main/tools/index.ts` — register new tools
- `src/main/agent/agent-loop.ts` — hook into file reads for passive indexing
- `package.json` — add tree-sitter native bindings, better-sqlite3 or sql.js

---

## Verification

- [ ] Agent reads a file → that file is indexed (passive indexing works)
- [ ] `codebaseSearch` returns relevant results for natural language queries
- [ ] Graph queries find callers/callees across files
- [ ] Incremental re-index on file change completes in < 100ms
- [ ] Full index of 10K file project completes in < 5 minutes
- [ ] Architectural notes from conversation N are available in conversation N+1
- [ ] Memory footprint stays within budget (~200MB peak)
- [ ] Background indexing does not block the agent or UI
