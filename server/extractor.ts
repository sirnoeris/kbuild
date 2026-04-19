/**
 * File extractors — convert raw files into plain text for wiki conversion.
 * Uses proper parsing libraries for each format.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

// Works in both ESM (tsx dev) and CJS (esbuild prod bundle)
const _require = createRequire(import.meta.url);

export interface Document {
  path: string;
  kind: string;
  title: string;
  text: string;
  error?: string;
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

  try {
    switch (kind) {
      case "md":
      case "txt": {
        const text = fs.readFileSync(absPath, "utf-8");
        return { path: relPath, kind, title, text };
      }

      case "html": {
        const raw = fs.readFileSync(absPath, "utf-8");
        const text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p>/gi, "\n\n")
          .replace(/<\/h[1-6]>/gi, "\n")
          .replace(/<h([1-6])[^>]*>/gi, (_, n) => "#".repeat(parseInt(n)) + " ")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/\s{3,}/g, "\n\n")
          .trim();
        return { path: relPath, kind, title, text };
      }

      case "csv": {
        const text = fs.readFileSync(absPath, "utf-8");
        return { path: relPath, kind, title, text };
      }

      case "pdf": {
        // pdf-parse v1 exports a plain async function
        const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> = _require("pdf-parse");
        const buf = fs.readFileSync(absPath);
        const data = await pdfParse(buf);
        const text = data.text?.trim() ?? "";
        if (text.length < 50) {
          return {
            path: relPath, kind, title,
            text: `[PDF: ${path.basename(filePath)} — text extraction returned minimal content. The PDF may be scanned/image-based. File size: ${Math.round(buf.length / 1024)}KB, Pages: ${data.numpages}]`,
          };
        }
        return { path: relPath, kind, title, text };
      }

      case "docx": {
        const mammoth = _require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
        const buf = fs.readFileSync(absPath);
        const result = await mammoth.extractRawText({ buffer: buf });
        return { path: relPath, kind, title, text: result.value };
      }

      case "pptx": {
        // PPTX is a zip — extract slide XML text
        const AdmZip = _require("adm-zip");
        const zip = new AdmZip(absPath);
        const slideEntries = zip.getEntries()
          .filter((e: any) => e.entryName.match(/ppt\/slides\/slide\d+\.xml$/))
          .sort((a: any, b: any) => a.entryName.localeCompare(b.entryName));
        const parts: string[] = [];
        for (const entry of slideEntries) {
          const xml = entry.getData().toString("utf-8");
          const texts = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
          const slideText = texts.map((t: string) => t.replace(/<[^>]+>/g, "")).join(" ").trim();
          if (slideText) parts.push(slideText);
        }
        return { path: relPath, kind, title, text: parts.join("\n\n") || `[PPTX: ${path.basename(filePath)}]` };
      }

      case "xlsx": {
        const XLSX = _require("xlsx") as typeof import("xlsx");
        const wb = XLSX.readFile(absPath);
        const parts: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(ws);
          if (csv.trim()) parts.push(`## Sheet: ${sheetName}\n\n${csv}`);
        }
        return { path: relPath, kind, title, text: parts.join("\n\n") || `[XLSX: ${path.basename(filePath)}]` };
      }

      default:
        return { path: relPath, kind, title, text: "", error: `Unsupported file type: ${path.extname(filePath)}` };
    }
  } catch (err: any) {
    return { path: relPath, kind, title, text: "", error: `Extraction failed: ${err.message}` };
  }
}
