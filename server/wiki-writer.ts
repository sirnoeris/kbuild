/**
 * Wiki writer — produces wiki/sources/*.md pages from full-text Markdown content.
 */
import fs from "fs";
import path from "path";
import { storage } from "./storage.js";

export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * Write a wiki source page from a full Markdown body.
 * The body is the complete converted document — no summarisation, no schema.
 */
export function writeSourceWikiPage(
  vaultRoot: string,
  filePath: string,   // relative path of the source file
  title: string,
  markdownBody: string
): string {
  const wikiDir = path.join(vaultRoot, "wiki", "sources");
  fs.mkdirSync(wikiDir, { recursive: true });

  const slug = slugify(title || path.basename(filePath, path.extname(filePath)));
  const wikiPath = path.join(wikiDir, `${slug}.md`);
  const relWikiPath = path.relative(vaultRoot, wikiPath);
  const now = new Date().toISOString();

  // Frontmatter + full body
  const content = `---
title: "${title.replace(/"/g, '\\"')}"
source: "${filePath}"
type: "source"
last_updated: ${now}
---

${markdownBody.trim()}
`;

  fs.writeFileSync(wikiPath, content, "utf-8");

  // Derive a plain-text summary from the first non-heading paragraph
  const firstPara = markdownBody.split(/\n{2,}/).find(l => l.trim() && !l.startsWith("#")) ?? "";
  const summary = firstPara.replace(/[#*_`\[\]]/g, "").slice(0, 300);

  // Upsert into DB for FTS
  storage.upsertWikiPage({
    path: relWikiPath,
    title,
    type: "source",
    tags: "[]",
    summary,
    body: content,
    sourceFile: filePath,
    lastUpdated: now,
  });

  return relWikiPath;
}

export function regenerateIndexFiles(vaultRoot: string) {
  const wikiDir = path.join(vaultRoot, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });

  const pages = storage.getWikiPages();
  const sources = pages.filter(p => p.type === "source");

  const sourcesContent = `---
title: "Sources Index"
type: "index"
last_updated: ${new Date().toISOString()}
---

# Sources Index

${sources.length} source files in this knowledge base.

| File | Summary |
|------|---------|
${sources.map(s => `| [[${s.path.split("/").pop()?.replace(".md", "")}\\|${s.title}]] | ${s.summary.slice(0, 120)} |`).join("\n")}
`;

  fs.writeFileSync(path.join(wikiDir, "SOURCES.md"), sourcesContent, "utf-8");
}
