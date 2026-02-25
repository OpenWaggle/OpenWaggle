# 31 — Codebase Memory & Semantic Indexing

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None
**Origin:** Spec 14

---

## Goal

Build a local knowledge graph that passively indexes the codebase as the agent works, combining embeddings, AST structure, and git history into unified context. First session the agent knows nothing; 50th session it understands the architecture like a senior dev.

This evolves Spec 29 (Codebase Indexing) from a basic search feature into a comprehensive memory system.

## Architecture

### Knowledge Graph Layers

- **Vector embeddings** — semantic search
- **AST structure** — exact relationships (calls, imports, exports)
- **Git history** — temporal context
- **Agent memory** — LLM-generated architectural notes that persist across sessions

### Storage

```
{userData}/knowledge/{project-hash}/
  embeddings.sqlite   # vectors + metadata
  graph.sqlite        # AST relationships, entities
  memory.sqlite       # agent notes, decisions, patterns
```

SQLite for everything: ACID transactions, single-file portability, WAL mode.

## Implementation

### Phase 1: Passive Indexing Foundation
- [ ] `src/main/knowledge/indexer.ts` — background worker, indexes files as agent reads them
- [ ] `src/main/knowledge/chunker.ts` — tree-sitter-based semantic chunking
- [ ] `src/main/knowledge/embedder.ts` — local embedding via @xenova/transformers
- [ ] `src/main/knowledge/vector-store.ts` — SQLite vector storage + cosine similarity
- [ ] `src/main/knowledge/graph-store.ts` — SQLite relationship graph

### Phase 2: Agent Tools
- [ ] `codebaseSearch` — semantic + structural search
- [ ] `codebaseUnderstand` — entity definition + callers + callees + git changes + agent notes

### Phase 3: Progressive Background Indexing
- [ ] Priority-based: agent-read files first, neighbors second, full sweep third
- [ ] File change watching via chokidar/fs.watch

### Phase 4: Architectural Memory
- [ ] Post-conversation synthesis: extract architectural facts
- [ ] Memory retrieval in system prompt for new conversations
- [ ] Memory decay: demote unused notes after 30 days

### Phase 5: Settings & UI
- [ ] Index status panel, re-index button, model selection

## Resource Budget (10K file codebase)

| Component | Disk | Memory (peak) |
|-----------|------|---------------|
| Embedding model | ~23MB | ~100MB |
| Vectors (30K chunks) | ~60MB | ~80MB |
| AST graph | ~50MB | ~30MB |
| **Total** | **~140MB** | **~215MB** |

## Files to Create

- `src/main/knowledge/indexer.ts`
- `src/main/knowledge/chunker.ts`
- `src/main/knowledge/embedder.ts`
- `src/main/knowledge/vector-store.ts`
- `src/main/knowledge/graph-store.ts`
- `src/main/knowledge/memory-store.ts`
- `src/main/tools/tools/codebase-search.ts`
- `src/main/tools/tools/codebase-understand.ts`

## Files to Modify

- `src/main/index.ts` — initialize indexer
- `src/main/tools/index.ts` — register new tools
- `src/main/agent/agent-loop.ts` — hook into file reads for passive indexing
- `package.json` — add tree-sitter, better-sqlite3
