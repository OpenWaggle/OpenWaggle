/**
 * Serialises Review comments into the message sent to the agent.
 *
 * Deliberately pure over the raw unified patch rather than the renderer's parsed
 * model: the payload is the contract with the agent, so it must not change shape
 * if the diff renderer is ever swapped again.
 */
const MIN_FENCE_LENGTH = 3;
const DEFAULT_CONTEXT_LINES = 3;
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HUNK_HEADER_OLD_START_GROUP = 1;
const HUNK_HEADER_NEW_START_GROUP = 2;
/**
 * Walk a unified patch tracking both line numberings. Header lines (`diff --git`,
 * `index`, `---`, `+++`) carry no line numbers and are dropped, so a snippet is
 * always renderable diff body.
 */
export function readPatchLines(patch) {
    const lines = [];
    let oldLine = 0;
    let newLine = 0;
    let inHunk = false;
    for (const raw of patch.split('\n')) {
        const header = HUNK_HEADER_PATTERN.exec(raw);
        if (header !== null) {
            oldLine = Number(header[HUNK_HEADER_OLD_START_GROUP]);
            newLine = Number(header[HUNK_HEADER_NEW_START_GROUP]);
            inHunk = true;
            continue;
        }
        if (!inHunk)
            continue;
        if (raw.startsWith('\\'))
            continue;
        if (raw.startsWith('+')) {
            lines.push({ raw, oldLine: null, newLine });
            newLine += 1;
            continue;
        }
        if (raw.startsWith('-')) {
            lines.push({ raw, oldLine, newLine: null });
            oldLine += 1;
            continue;
        }
        // Context line: present on both sides.
        lines.push({ raw, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
    }
    return lines;
}
/**
 * The diff text a comment is anchored to, plus surrounding context so the agent
 * can see what changed without re-reading the file.
 */
export function extractDiffSnippet(patch, startLine, endLine, contextLines = DEFAULT_CONTEXT_LINES) {
    const lines = readPatchLines(patch);
    const inRange = (line) => {
        const number = line.newLine ?? line.oldLine;
        return number !== null && number >= startLine && number <= endLine;
    };
    const firstIndex = lines.findIndex(inRange);
    if (firstIndex === -1)
        return '';
    let lastIndex = firstIndex;
    for (let index = lines.length - 1; index >= firstIndex; index -= 1) {
        const line = lines[index];
        if (line !== undefined && inRange(line)) {
            lastIndex = index;
            break;
        }
    }
    const from = Math.max(0, firstIndex - contextLines);
    const to = Math.min(lines.length - 1, lastIndex + contextLines);
    return lines
        .slice(from, to + 1)
        .map((line) => line.raw)
        .join('\n');
}
/**
 * Fence long enough to survive the contents. A diff of a Markdown file routinely
 * contains ``` itself, which would otherwise terminate the block early and
 * corrupt everything after it in the message.
 */
export function formatFence(language, contents) {
    const longestRun = Math.max(0, ...Array.from(contents.matchAll(/`+/g), (match) => match[0].length));
    const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
    return [`${fence}${language}`, contents.replace(/\s+$/, ''), fence].join('\n');
}
function escapeAttribute(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
export function formatLineRange(startLine, endLine) {
    return startLine === endLine
        ? `L${String(startLine)}`
        : `L${String(startLine)}-L${String(endLine)}`;
}
/**
 * A user can paste or type the closing tag inside their own comment, which would end
 * the block early and hand the agent a malformed payload. Neutralise it rather than
 * dropping it, so the text the reviewer wrote still reaches the agent verbatim enough
 * to read.
 */
function escapeClosingTag(content) {
    return content.replaceAll('</review_comment>', '<\\/review_comment>');
}
/** One structured, machine-parseable comment block. */
export function formatReviewCommentBlock(comment) {
    const open = '<review_comment' +
        ` filePath="${escapeAttribute(comment.filePath)}"` +
        ` startLine="${String(comment.startLine)}"` +
        ` endLine="${String(comment.endLine)}"` +
        ` range="${escapeAttribute(formatLineRange(comment.startLine, comment.endLine))}"` +
        '>';
    const parts = [open, escapeClosingTag(comment.content.trim())];
    if (comment.diff.trim() !== '')
        parts.push(formatFence('diff', comment.diff));
    parts.push('</review_comment>');
    return parts.join('\n');
}
/**
 * The whole Review as one message: optional summary framing, then every comment.
 * Mirrors a GitLab review submission -- one turn, not one message per comment.
 */
export function formatReviewSubmission(summary, comments) {
    const trimmedSummary = summary.trim();
    const sections = ['**Code review**'];
    if (trimmedSummary !== '')
        sections.push(trimmedSummary);
    for (const comment of comments)
        sections.push(formatReviewCommentBlock(comment));
    return sections.join('\n\n');
}
/** A single comment sent on its own, without opening a Review. */
export function formatSingleReviewComment(comment) {
    return ['**Review comment**', formatReviewCommentBlock(comment)].join('\n\n');
}
