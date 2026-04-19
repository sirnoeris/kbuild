/**
 * Comprehensive extraction test — run with: npx tsx test-extract.ts
 * Tests every supported format and reports pass/fail with extracted text.
 */
import { extractDocument, getFileKind } from "./server/extractor.js";
import path from "path";
import fs from "fs";

const VAULT = "/tmp";

interface TestCase {
  file: string;
  expectedKind: string;
  mustContain: string[];
}

const tests: TestCase[] = [
  {
    file: "/tmp/test.pdf",
    expectedKind: "pdf",
    mustContain: ["PDF", "reader"],  // from orimi test PDF
  },
  {
    file: "/tmp/test.docx",
    expectedKind: "docx",
    mustContain: ["Test Word Document", "paragraph", "500 patients"],
  },
  {
    file: "/tmp/test.xlsx",
    expectedKind: "xlsx",
    mustContain: ["Sheet", "Name", "Value"],
  },
  {
    file: "/tmp/test.pptx",
    expectedKind: "pptx",
    mustContain: ["Title Slide", "Test Presentation", "Findings", "95%"],
  },
  {
    file: "/tmp/test.csv",
    expectedKind: "csv",
    mustContain: ["Name,Age,Diagnosis", "Metformin", "Lisinopril"],
  },
  {
    file: "/tmp/test.html",
    expectedKind: "html",
    mustContain: ["Research Summary", "Methods", "p<0.001"],
  },
  {
    file: "/tmp/test.txt",
    expectedKind: "txt",
    mustContain: ["Plain Text Document", "Accuracy: 94.3%", "machine learning"],
  },
  {
    file: "/tmp/test.md",
    expectedKind: "md",
    mustContain: ["Markdown Test Document", "Abstract", "Limitations"],
  },
];

let passed = 0;
let failed = 0;

console.log("\n═══════════════════════════════════════════════════════");
console.log("  KBuild Extractor — Comprehensive Format Tests");
console.log("═══════════════════════════════════════════════════════\n");

for (const tc of tests) {
  const ext = path.extname(tc.file);
  const kind = getFileKind(tc.file);
  process.stdout.write(`[${ext.toUpperCase().padEnd(5)}] ${path.basename(tc.file)} ... `);

  if (!fs.existsSync(tc.file)) {
    console.log("SKIP (file not found)");
    continue;
  }

  try {
    const doc = await extractDocument(tc.file, VAULT);

    if (doc.error && !doc.text) {
      console.log(`FAIL — error: ${doc.error}`);
      failed++;
      continue;
    }

    if (kind !== tc.expectedKind) {
      console.log(`FAIL — kind mismatch: got "${kind}", expected "${tc.expectedKind}"`);
      failed++;
      continue;
    }

    const missing = tc.mustContain.filter(s => !doc.text.includes(s));
    if (missing.length > 0) {
      console.log(`FAIL — missing: ${missing.join(", ")}`);
      console.log(`  Extracted text (first 400 chars):\n  ${doc.text.slice(0, 400).replace(/\n/g, "\\n")}`);
      failed++;
      continue;
    }

    console.log(`PASS — ${doc.text.length} chars extracted`);
    passed++;
  } catch (err: any) {
    console.log(`FAIL — threw: ${err.message}`);
    failed++;
  }
}

console.log("\n───────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
console.log("───────────────────────────────────────────────────────\n");

if (failed > 0) process.exit(1);
