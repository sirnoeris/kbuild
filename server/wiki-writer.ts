/**
 * Wiki writer — produces and maintains wiki/sources/*.md and wiki/topics/*.md
 * from LLM summarization output.
 */
import fs from "fs";
import path from "path";
import { storage } from "./storage.js";

export interface SummaryResult {
  title: string;
  summary: string;
  keyPoints: string[];
  methodology: string | null;
  limitations: string | null;
  keyResults: string | null;
  concepts: string[];
  relatedTopics: string[];
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function parseSummaryFromLLM(raw: string, fallbackTitle: string): SummaryResult {
  // Try JSON first
  try {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        title: parsed.title ?? fallbackTitle,
        summary: parsed.summary ?? "",
        keyPoints: Array.isArray(parsed.key_points) ? parsed.key_points : (parsed.keyPoints ?? []),
        methodology: (typeof parsed.methodology === "string" && parsed.methodology !== "null") ? parsed.methodology : null,
        limitations: (typeof parsed.limitations === "string" && parsed.limitations !== "null") ? parsed.limitations : null,
        keyResults: (typeof parsed.key_results === "string" && parsed.key_results !== "null") ? parsed.key_results : null,
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        relatedTopics: Array.isArray(parsed.related_topics) ? parsed.related_topics : (parsed.relatedTopics ?? []),
      };
    }
  } catch {}

  // Fallback: parse sections
  const lines = raw.split("\n");
  let summary = "";
  const keyPoints: string[] = [];
  const concepts: string[] = [];
  const relatedTopics: string[] = [];
  let section = "";

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (/^#+\s*summary/i.test(l) || /^summary:/i.test(l)) { section = "summary"; continue; }
    if (/^#+\s*key\s*points?/i.test(l) || /^key\s*points?:/i.test(l)) { section = "keypoints"; continue; }
    if (/^#+\s*concepts?/i.test(l) || /^key\s*concepts?:/i.test(l)) { section = "concepts"; continue; }
    if (/^#+\s*related/i.test(l) || /^related/i.test(l)) { section = "related"; continue; }

    if (section === "summary" && !summary) summary = l;
    else if (section === "keypoints" && /^[-*•]/.test(l)) keyPoints.push(l.replace(/^[-*•]\s*/, ""));
    else if (section === "concepts" && /^[-*•]/.test(l)) concepts.push(l.replace(/^[-*•]\s*/, ""));
    else if (section === "related" && /^[-*•]/.test(l)) relatedTopics.push(l.replace(/^[-*•]\s*/, ""));
    else if (!summary && !section) summary = l;
  }

  return { title: fallbackTitle, summary: summary || raw.slice(0, 300), keyPoints, methodology: null, limitations: null, keyResults: null, concepts, relatedTopics };
}

export function writeSourceWikiPage(
  vaultRoot: string,
  filePath: string, // relative to vault root
  result: SummaryResult
): string {
  const wikiDir = path.join(vaultRoot, "wiki", "sources");
  fs.mkdirSync(wikiDir, { recursive: true });

  const slug = slugify(result.title || path.basename(filePath, path.extname(filePath)));
  const wikiPath = path.join(wikiDir, `${slug}.md`);
  const relWikiPath = path.relative(vaultRoot, wikiPath);
  const now = new Date().toISOString();

  const tags = result.concepts.slice(0, 8).map(c => `"${c}"`).join(", ");
  const relatedLinks = result.relatedTopics
    .map(t => `- [[${slugify(t)}]]`)
    .join("\n");
  const keyPointsList = result.keyPoints
    .map(kp => `- ${kp}`)
    .join("\n");
  const conceptsList = result.concepts
    .map(c => `- \`${c}\``)
    .join("\n");

  const methodologySection = result.methodology
    ? `\n## Methodology\n\n${result.methodology}\n`
    : "";
  const limitationsSection = result.limitations
    ? `\n## Limitations\n\n${result.limitations}\n`
    : "";
  const keyResultsSection = result.keyResults
    ? `\n## Key Results\n\n${result.keyResults}\n`
    : "";

  const content = `---
title: "${result.title.replace(/"/g, '\\"')}"
source: "${filePath}"
type: "source"
tags: [${tags}]
last_updated: ${now}
---

${result.summary}

## Key Points

${keyPointsList || "- No key points extracted."}
${keyResultsSection}${methodologySection}${limitationsSection}
## Key Concepts

${conceptsList || "- No concepts extracted."}

## Related Topics

${relatedLinks || "- No related topics identified."}
`;

  fs.writeFileSync(wikiPath, content, "utf-8");

  // Upsert into DB for FTS
  storage.upsertWikiPage({
    path: relWikiPath,
    title: result.title,
    type: "source",
    tags: JSON.stringify(result.concepts.slice(0, 8)),
    summary: result.summary,
    body: content,
    sourceFile: filePath,
    lastUpdated: now,
  });

  return relWikiPath;
}

export function ensureTopicPage(vaultRoot: string, topicSlug: string, topicName: string) {
  const topicsDir = path.join(vaultRoot, "wiki", "topics");
  fs.mkdirSync(topicsDir, { recursive: true });

  const topicPath = path.join(topicsDir, `${topicSlug}.md`);
  const relPath = path.relative(vaultRoot, topicPath);

  if (!fs.existsSync(topicPath)) {
    const now = new Date().toISOString();
    const content = `---
title: "${topicName.replace(/"/g, '\\"')}"
type: "topic"
tags: []
last_updated: ${now}
---

*Topic page for ${topicName}. This page is auto-generated and will be updated as more sources referencing this topic are processed.*
`;
    fs.writeFileSync(topicPath, content, "utf-8");
    storage.upsertWikiPage({
      path: relPath,
      title: topicName,
      type: "topic",
      tags: "[]",
      summary: `Topic: ${topicName}`,
      body: content,
      sourceFile: undefined,
      lastUpdated: now,
    });
  }
}

export function regenerateIndexFiles(vaultRoot: string) {
  const wikiDir = path.join(vaultRoot, "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });

  const pages = storage.getWikiPages();
  const sources = pages.filter(p => p.type === "source");
  const topics = pages.filter(p => p.type === "topic");

  // SOURCES.md
  const sourcesContent = `---
title: "Sources Index"
type: "index"
last_updated: ${new Date().toISOString()}
---

# Sources Index

All source files processed into this knowledge base.

| File | Summary |
|------|---------|
${sources.map(s => `| [[${s.path.split("/").pop()?.replace(".md", "")}\\|${s.title}]] | ${s.summary.slice(0, 100)}... |`).join("\n")}
`;

  // INDEX.md
  const indexContent = `---
title: "Topic Index"
type: "index"
last_updated: ${new Date().toISOString()}
---

# Knowledge Base Index

${topics.length} topics across ${sources.length} sources.

## Topics

${topics.map(t => `- [[${t.path.split("/").pop()?.replace(".md", "")}|${t.title}]] — ${t.summary.slice(0, 80)}`).join("\n")}

## Sources

${sources.map(s => `- [[${s.path.split("/").pop()?.replace(".md", "")}|${s.title}]]`).join("\n")}
`;

  fs.writeFileSync(path.join(wikiDir, "SOURCES.md"), sourcesContent, "utf-8");
  fs.writeFileSync(path.join(wikiDir, "INDEX.md"), indexContent, "utf-8");
}
