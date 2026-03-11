# 36 — Distribution Repos (Homebrew Tap + Scoop Bucket)

## Status: Deferred

Deferred from the initial ship (`feat/ship-to-users`). These repos depend on having at least one published GitHub release with platform artifacts.

## Goal

Enable `brew install --cask openwaggle` (macOS) and `scoop install openwaggle` (Windows) by creating dedicated distribution repos and automating manifest updates from the release workflow.

## Deliverables

### 1. Homebrew Tap — `OpenWaggle/homebrew-tap`

- Create public repo `OpenWaggle/homebrew-tap`
- Add `Casks/openwaggle.rb` with a **pinned version** cask (not `:latest`)
  - `url` pointing to the `.dmg` asset on the GitHub release
  - `sha256` from `SHA256SUMS.txt`
  - `version` matching the release tag (strip `v` prefix)
- Test locally: `brew tap OpenWaggle/tap && brew install --cask openwaggle`

### 2. Scoop Bucket — `OpenWaggle/scoop-bucket`

- Create public repo `OpenWaggle/scoop-bucket`
- Add `bucket/openwaggle.json` manifest
  - `url` pointing to the `.exe` NSIS installer on the GitHub release
  - `hash` from `SHA256SUMS.txt`
  - `version` matching the release tag
- Test locally: `scoop bucket add openwaggle https://github.com/OpenWaggle/scoop-bucket && scoop install openwaggle`

### 3. Release Workflow Integration

Add an `update-dist-repos` job to `.github/workflows/release.yml`:

```yaml
update-dist-repos:
  name: Update Distribution Repos
  needs: [version, release]
  if: needs.version.outputs.should_release == 'true'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Download SHA256SUMS
      uses: actions/download-artifact@v4
      with:
        path: artifacts

    - name: Update Homebrew cask
      env:
        DIST_REPOS_PAT: ${{ secrets.DIST_REPOS_PAT }}
      run: |
        VERSION="${{ needs.version.outputs.new_version }}"
        TAG="${{ needs.version.outputs.new_tag }}"
        SHA_DMG=$(grep '\.dmg$' artifacts/*/SHA256SUMS.txt | head -1 | awk '{print $1}')
        # Clone, update cask, commit, push
        git clone https://x-access-token:${DIST_REPOS_PAT}@github.com/OpenWaggle/homebrew-tap.git
        cd homebrew-tap
        # Update version, url, sha256 in Casks/openwaggle.rb
        # ... (template script)

    - name: Update Scoop manifest
      env:
        DIST_REPOS_PAT: ${{ secrets.DIST_REPOS_PAT }}
      run: |
        VERSION="${{ needs.version.outputs.new_version }}"
        TAG="${{ needs.version.outputs.new_tag }}"
        SHA_EXE=$(grep '\.exe$' artifacts/*/SHA256SUMS.txt | head -1 | awk '{print $1}')
        # Clone, update manifest, commit, push
        git clone https://x-access-token:${DIST_REPOS_PAT}@github.com/OpenWaggle/scoop-bucket.git
        cd scoop-bucket
        # Update version, url, hash in bucket/openwaggle.json
        # ... (template script)
```

### 4. PAT Setup

- Create a fine-grained PAT (`DIST_REPOS_PAT`) scoped to `OpenWaggle/homebrew-tap` and `OpenWaggle/scoop-bucket` with `contents: write`
- Add as a repository secret in `OpenWaggle/OpenWaggle`

## Prerequisites

- At least one published GitHub release with `.dmg`, `.exe`, and `SHA256SUMS.txt` assets
- The two distribution repos created and initialized

## Verification

- [ ] `brew tap OpenWaggle/tap && brew install --cask openwaggle` installs the correct version
- [ ] `scoop bucket add openwaggle ... && scoop install openwaggle` installs the correct version
- [ ] Pushing a new release to `main` automatically updates both distribution repos
