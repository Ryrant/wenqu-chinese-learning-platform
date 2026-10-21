import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Log, LogLevel, Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const paragraphs = [
  "Students practise Chinese and share family stories.",
  "华文学习连接课堂与家庭，孩子分享自己的故事，教师记录真实表达。",
];
const normalizedText = (text) => text.replace(/[ \t]+/g, " ");

// 有完整 xref、两页与嵌入 ToUnicode 映射的文字 PDF，无需网络字体或外部文件。
function textPdf(pages = paragraphs) {
  const characters = [...new Set(pages.join(""))];
  const characterIds = new Map(characters.map((character, index) => [character, index + 1]));
  const hex = (value) => value.toString(16).padStart(4, "0");
  const unicode = (character) => [...Array(character.length)].map((_, index) => hex(character.charCodeAt(index))).join("");
  const cmap = [
    "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /FixtureUnicode def", "/CMapType 2 def",
    "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
    `${characters.length} beginbfchar`,
    ...characters.map((character) => `<${hex(characterIds.get(character))}> <${unicode(character)}>`),
    "endbfchar", "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${8 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /FixtureFont /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 1000 /CIDToGIDMap /Identity >>",
    "<< /Type /FontDescriptor /FontName /FixtureFont /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>",
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
    "<< >>",
  ];
  for (const [index, paragraph] of pages.entries()) {
    const content = `BT /F1 10 Tf 30 720 Td <${[...paragraph].map((character) => hex(characterIds.get(character))).join("")}> Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${9 + index * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  let document = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(document);
}

async function temporaryDirectory(t) {
  const parent = path.join(root, "work");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "pdf-extraction-"));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(parent), "只清理本次创建的 work 临时目录");
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

test("Node extracts complete multi-page English and Chinese PDF text and retains real failures", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "node.mjs");
  await build({
    stdin: { contents: "export { extractPdfText } from './lib/content-processing';", resolveDir: root },
    outfile: output, bundle: true, platform: "node", format: "esm", target: "node22", packages: "external",
  });
  const { extractPdfText } = await import(pathToFileURL(output).href);
  const file = (bytes) => new File([bytes], "fixture.pdf", { type: "application/pdf" });
  const result = await extractPdfText(file(textPdf()));
  assert.equal(result.kind, "pdf");
  assert.equal(normalizedText(result.text), paragraphs.join("\n\n"));
  await assert.rejects(extractPdfText(file(textPdf([""]))), /unsupported_scanned_pdf/);
  await assert.rejects(extractPdfText(file(new TextEncoder().encode("This is not a PDF document."))), /Invalid PDF structure/);
  assert.equal(normalizedText((await extractPdfText(file(textPdf()))).text), paragraphs.join("\n\n"));
});

test("Workerd extracts PDF text without browser graphics or a separate worker file and isolates concurrent documents", async (t) => {
  const directory = await temporaryDirectory(t);
  const output = path.join(directory, "worker.mjs");
  await build({
    stdin: { contents: `
      import { extractPdfText } from './lib/content-processing';
      const nativeDOMMatrix = typeof globalThis.DOMMatrix !== 'undefined';
      export default { async fetch(request) {
        try {
          const file = new File([await request.arrayBuffer()], 'fixture.pdf', { type: 'application/pdf' });
          return Response.json({ result: await extractPdfText(file), nativeDOMMatrix });
        } catch (error) {
          return Response.json({ error: error.message }, { status: 422 });
        }
      }};
    `, resolveDir: root },
    outfile: output, bundle: true, platform: "browser", format: "esm", target: "es2022", logLevel: "error", external: ["node:*"],
  });
  const runtime = new Miniflare({
    modules: [{ type: "ESModule", path: output }],
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
    host: "127.0.0.1", port: 0, log: new Log(LogLevel.NONE),
  });
  t.after(() => runtime.dispose());
  const extract = (body) => runtime.dispatchFetch("http://127.0.0.1/pdf", { method: "POST", body });
  const secondText = "Another independent classroom document contains different evidence.";
  const [first, second] = await Promise.all([extract(textPdf()), extract(textPdf([secondText]))]);
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal(second.status, 200, await second.clone().text());
  const payload = await first.json();
  assert.equal(payload.nativeDOMMatrix, false);
  assert.equal(payload.result.kind, "pdf");
  assert.equal(normalizedText(payload.result.text), paragraphs.join("\n\n"));
  assert.equal(normalizedText((await second.json()).result.text), secondText);
  const blank = await extract(textPdf([""]));
  assert.equal(blank.status, 422);
  assert.equal((await blank.json()).error, "unsupported_scanned_pdf");
  const malformed = await extract(new TextEncoder().encode("This is not a PDF document."));
  assert.equal(malformed.status, 422);
  assert.match((await malformed.json()).error, /Invalid PDF structure/);
  assert.equal(normalizedText((await (await extract(textPdf())).json()).result.text), paragraphs.join("\n\n"));
});
