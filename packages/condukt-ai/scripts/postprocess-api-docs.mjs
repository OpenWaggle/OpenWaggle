import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.cwd(), "../../apps/web/src/content/docs/api-reference/generated");
await processDir(root);

async function processDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await processDir(fullPath);
      continue;
    }

    if (!entry.isFile() || !fullPath.endsWith(".md")) {
      continue;
    }

    const content = await readFile(fullPath, "utf8");
    const rewrittenSourceLinks = normalizeGitHubBlobRefs(content);
    const rewrittenLinks = rewriteMarkdownLinks(rewrittenSourceLinks);
    if (rewrittenLinks.startsWith("---\n")) {
      if (rewrittenLinks !== content) {
        await writeFile(fullPath, rewrittenLinks, "utf8");
      }
      continue;
    }

    const title = inferTitle(rewrittenLinks, entry.name.replace(/\.md$/i, ""));
    const withFrontmatter = `---\ntitle: ${escapeYaml(title)}\n---\n\n${rewrittenLinks}`;
    await writeFile(fullPath, withFrontmatter, "utf8");
  }
}

function inferTitle(content, fallback) {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  if (fallback.toLowerCase() === "readme") {
    return "API Index";
  }

  return fallback;
}

function escapeYaml(value) {
  return JSON.stringify(value);
}

function rewriteMarkdownLinks(content) {
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, target) => {
    const normalizedTarget = rewriteTarget(target);
    if (normalizedTarget === target) {
      return match;
    }
    return `[${label}](${normalizedTarget})`;
  });
}

function rewriteTarget(target) {
  if (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:") ||
    target.startsWith("tel:") ||
    target.startsWith("#")
  ) {
    return target;
  }

  const [pathPart, hashPart] = target.split("#", 2);
  if (!pathPart.toLowerCase().endsWith(".md")) {
    return target;
  }

  const withoutExtension = pathPart.replace(/\.md$/i, "");
  const lowercased = withoutExtension
    .split("/")
    .map((segment) => {
      if (segment === "" || segment === "." || segment === "..") {
        return segment;
      }
      return segment.toLowerCase();
    })
    .join("/");
  const asRoute = lowercased.endsWith("/") ? lowercased : `${lowercased}/`;

  if (!hashPart) {
    return asRoute;
  }

  return `${asRoute}#${hashPart}`;
}

function normalizeGitHubBlobRefs(content) {
  return content.replace(
    /(https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/)[0-9a-f]{7,40}(\/[^)\s]+)/g,
    "$1main$2",
  );
}
