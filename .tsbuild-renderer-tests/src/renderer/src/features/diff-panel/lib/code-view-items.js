import { parsePatchFiles } from '@pierre/diffs';
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const HASH_RADIX = 36;
/**
 * Content-addressed cache key. The renderer caches parsed and highlighted output
 * per key, so the key must change whenever the patch text changes -- keying by
 * file path alone would serve a stale diff after the agent edits the same file.
 */
function hashPatch(patch) {
    let hash = FNV_OFFSET_BASIS_32;
    for (let index = 0; index < patch.length; index += 1) {
        hash ^= patch.charCodeAt(index);
        hash = Math.imul(hash, FNV_PRIME_32);
    }
    return (hash >>> 0).toString(HASH_RADIX);
}
export function codeViewItemId(filePath) {
    return `diff:${filePath}`;
}
/**
 * Parse one file's unified patch into renderer metadata. Returns null when the
 * patch yields no file (empty diff, or a mode-only change git reports with no
 * hunks) so callers can skip the item rather than render an empty section.
 */
function parseFileDiff(file) {
    const patches = parsePatchFiles(file.diff, `${file.path}-${hashPatch(file.diff)}`);
    for (const patch of patches) {
        const [first] = patch.files;
        if (first !== undefined)
            return first;
    }
    return null;
}
/**
 * Build the renderer's item list from the diffs we already load. One scroll
 * region containing many files is what CodeView is for, so the whole panel is a
 * single virtualized list rather than a component per file.
 *
 * `version` is content-addressed for the same reason as the cache key: CodeView
 * decides whether to re-render an item from its id plus version, so the version
 * must move when the patch or its annotations move.
 */
export function buildCodeViewItems(files, annotationsByPath) {
    const items = [];
    for (const file of files) {
        const fileDiff = parseFileDiff(file);
        if (fileDiff === null)
            continue;
        const annotations = annotationsByPath.get(file.path) ?? [];
        items.push({
            id: codeViewItemId(file.path),
            type: 'diff',
            fileDiff,
            annotations: [...annotations],
            version: versionFor(file.diff, annotations),
        });
    }
    return items;
}
function versionFor(patch, annotations) {
    const annotationSignature = annotations
        .map((a) => `${a.side}:${String(a.lineNumber)}:${a.metadata.kind}:${a.metadata.commentId ?? ''}`)
        .join('|');
    return Number.parseInt(hashPatch(`${patch}##${annotationSignature}`), HASH_RADIX);
}
