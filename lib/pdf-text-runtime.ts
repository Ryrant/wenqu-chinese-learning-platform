let preparing: Promise<void> | undefined;

/** 文本提取在当前线程运行 PDF.js 解析器，不创建浏览器 Worker 或渲染画布。 */
export function preparePdfTextRuntime(): Promise<void> {
  preparing ??= (async () => {
    // PDF.js 的显示模块加载时也会创建矩阵；Workers 没有浏览器几何 API。
    // 使用真实矩阵实现，避免依赖 Node 原生 canvas，也不覆盖已有浏览器实现。
    if (typeof globalThis.DOMMatrix === "undefined") {
      const { default: CSSMatrix } = await import("@thednp/dommatrix");
      globalThis.DOMMatrix = CSSMatrix as unknown as typeof DOMMatrix;
    }

    // 显式打包解析器：PDF.js 默认的相对动态 worker 路径不会随 Vite 产物生成。
    const { WorkerMessageHandler } = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const scope = globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: unknown } };
    scope.pdfjsWorker = { WorkerMessageHandler };
  })().catch((error) => {
    preparing = undefined;
    throw error;
  });
  return preparing;
}
