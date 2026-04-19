/**
 * File extractors — convert raw files into a Document structure (text + structure).
 * Pure Node.js, no LLM.
 */
import fs from "fs";
import path from "path";

export interface Document {
  path: string;
  kind: string;
  title: string;
  text: string;
  structure: string; // brief structural summary (headings, slides, etc.)
  error?: string;
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function getFileKind(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const kinds: Record<string, string> = {
    ".pdf": "pdf",
    ".html": "html",
    ".htm": "html",
    ".docx": "docx",
    ".pptx": "pptx",
    ".xlsx": "xlsx",
    ".xls": "xlsx",
    ".csv": "csv",
    ".md": "md",
    ".markdown": "md",
    ".txt": "txt",
    ".text": "txt",
  };
  return kinds[ext] ?? "other";
}

export function extractTitle(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ");
}

export async function extractDocument(filePath: string, vaultRoot: string): Promise<Document> {
  const kind = getFileKind(filePath);
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(vaultRoot, filePath);
  const relPath = path.relative(vaultRoot, absPath);
  const title = extractTitle(filePath);
  // relPath must be in scope for the catch block

  try {
    switch (kind) {
      case "md":
      case "txt": {
        const text = fs.readFileSync(absPath, "utf-8");
        const headings = text.match(/^#+\s.+/gm) ?? [];
        return {
          path: relPath, kind, title,
          text: text.slice(0, 80_000),
          structure: headings.slice(0, 20).join("\n"),
        };
      }

      case "html": {
        const raw = fs.readFileSync(absPath, "utf-8");
        // Strip tags, keep text
        const text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
        const headings = raw.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi) ?? [];
        const cleanHeadings = headings.map(h => h.replace(/<[^>]+>/g, "")).slice(0, 20);
        return {
          path: relPath, kind, title,
          text: text.slice(0, 80_000),
          structure: cleanHeadings.join("\n"),
        };
      }

      case "csv": {
        const text = fs.readFileSync(absPath, "utf-8");
        const lines = text.split("\n").filter(Boolean);
        const header = lines[0] ?? "";
        const sample = lines.slice(0, 6).join("\n");
        return {
          path: relPath, kind, title,
          text: `Columns: ${header}\n\nSample rows:\n${sample}\n\nTotal rows: ${lines.length - 1}`,
          structure: `CSV with ${lines.length - 1} data rows and columns: ${header}`,
        };
      }

      // For binary formats (PDF, DOCX, PPTX, XLSX) we extract what we can via buffers
      // and note that full text extraction requires optional native deps
      case "pdf": {
        // Attempt basic PDF text extraction (look for readable text streams)
        const buf = fs.readFileSync(absPath);
        const str = buf.toString("latin1");
        // Very basic PDF text extraction: find BT...ET blocks
        const matches = str.match(/BT[\s\S]*?ET/g) ?? [];
        const textParts: string[] = [];
        for (const block of matches) {
          const tj = block.match(/\(([^)]+)\)/g) ?? [];
          const words = tj.map(t => t.slice(1, -1)).join(" ");
          if (words.trim()) textParts.push(words);
        }
        const extracted = textParts.join(" ").replace(/\s+/g, " ").trim();
        const text = extracted.length > 100
          ? extracted.slice(0, 80_000)
          : `[PDF file: ${path.basename(filePath)} — ${Math.round(buf.length / 1024)}KB. Content extraction limited — LLM will summarize based on filename and metadata.]`;
        return {
          path: relPath, kind, title,
          text,
          structure: `PDF document: ${Math.round(buf.length / 1024)}KB`,
        };
      }

      case "docx":
      case "pptx":
      case "xlsx": {
        const buf = fs.readFileSync(absPath);
        const size = Math.round(buf.length / 1024);
        const kindLabel = { docx: "Word document", pptx: "PowerPoint presentation", xlsx: "Excel spreadsheet" }[kind] ?? kind;
        return {
          path: relPath, kind, title,
          text: `[${kindLabel}: ${path.basename(filePath)} — ${size}KB. Binary format — LLM will create a summary based on filename and file type. For full extraction, convert to PDF or text first.]`,
          structure: `${kindLabel}, ${size}KB`,
        };
      }

      default:
        return {
          path: relPath, kind, title,
          text: "",
          structure: "",
          error: `Unsupported file type: ${path.extname(filePath)}`,
        };
    }
  } catch (err: any) {
    return {
      path: relPath, kind, title,
      text: "",
      structure: "",
      error: `Extraction failed: ${err.message}`,
    };
  }
}
