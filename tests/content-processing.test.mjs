import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("content processing module supports txt docx and pdf without OCR", async () => {
  const moduleText = await read("app/lib/content-processing.ts");
  assert.match(moduleText, /extractTxtText/);
  assert.match(moduleText, /extractDocxText/);
  assert.match(moduleText, /extractPdfText/);
  assert.match(moduleText, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  assert.doesNotMatch(moduleText, /^import \* as pdfjs from "pdfjs-dist";$/m);
  assert.match(moduleText, /export function chunkText/);
  assert.match(moduleText, /content.length <= 1000/);
  assert.match(moduleText, /chunkIndex/);
  assert.match(moduleText, /unsupported_scanned_pdf/);
  assert.doesNotMatch(moduleText, /OCR|Vectorize|transcription/);
});
