declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  // PDF.js 公开 worker 入口未附带类型；这里只将处理器传给同版本的主线程接口。
  export const WorkerMessageHandler: unknown;
}
