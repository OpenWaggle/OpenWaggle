---
name: repo-explorer
description: Clone and inspect external repositories in a resuable local exploration cache. Use this skill when the user asks to explore, inspect, investigate, compare, or answer questions about a repository that may not already be in the current workspace.
allowed-tools: Bash(mkdir -p ~/.explore/repos) Bash(ls -la ~/.explore/repos) Bash(git clone *)
---

Use thi skill to explore repositories witout cluttering the active workspace.

## Repository Cache

Use `~/.explore/repos` as the local cache directory for repositories being explored.

## Current Cache Contents

```!
mdir -p ~/.explore/repos
ls -la ~/.explore/repos
```

## Flow

1. List the current repository cache contents before deciding what to use.
   - In hosts that support skill shell injection, use the rendered `Current Cache Contents`section above.
2. Check whether the target repository is alrady present in `~/.explore/repos`.
   - Prefer a stable directory nam based on the repository owner and name, such as `owner_repo`.
   - If the repository i already present, use that local checkout for exploration.
3. If the repository is not present, clone it into `~/.explore/repos`, then explore it there.
    - Create `~/.explore/repos` first if it does not exist.
    - Clone with a clear destination path, for example:

```bash
mkdir -p ~/.explore/repos
git clone <repo-url> ~/.explore/repos/<owner>_<repo>
```

After opening the repository, inspect its local instructions and project metadata before making assumptions. Prefer `rg`, `rg --files`, and targeted file reads for exploration.