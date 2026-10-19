import { sequenceTime } from "./learning-sequence-types";
import { getAuthMode, platformApiError, type PlatformContext } from "./platform-store";
import { workspacePasswordChangeGate } from "./password-change-state";

// 所有作品、反馈及观察均来自用户输入；只能作为文本写入独立报告。
export function reportText(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
const css = `
  *{box-sizing:border-box}body{margin:0;background:#f3f4f3;color:#192b25;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:15px;line-height:1.65}
  main{max-width:940px;margin:24px auto;padding:32px;background:#fff;border:1px solid #d7ded9}h1{font-size:26px;line-height:1.4;margin:8px 0 14px}h2{font-size:20px;margin:28px 0 12px;border-bottom:1px solid #d7ded9;padding-bottom:5px}h3{font-size:17px;margin:16px 0 8px}p{margin:8px 0;overflow-wrap:anywhere}.copy{white-space:pre-wrap}small,.meta{color:#4c5f55;font-size:13px}.work{border-top:1px solid #d7ded9;padding:12px 0}.work:first-of-type{border-top:0}a{color:#205b46;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid #c6d0c9;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#f3f6f3}.table{max-width:100%;overflow:auto}img{display:block;max-width:100%;max-height:70mm;object-fit:contain;margin:12px 0}audio{display:block;width:100%;margin:12px 0}.toolbar{display:flex;gap:16px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #d7ded9;padding-bottom:16px;margin-bottom:20px}button{font:inherit;border:1px solid #205b46;border-radius:6px;padding:9px 16px;background:#205b46;color:white;cursor:pointer}footer{margin-top:24px;padding-top:12px;border-top:1px solid #d7ded9}.notice{padding:12px;border-left:3px solid #658776;background:#f3f6f3}
  @media(max-width:600px){main{margin:0;padding:20px 16px;border:0}body{font-size:14px}h1{font-size:22px}table{font-size:13px}th,td{padding:6px}}
  @page{size:A4;margin:16mm 14mm 18mm}
  @media print{body{background:#fff;color:#000;font-size:10.5pt}main{max-width:none;margin:0;padding:0;border:0}.toolbar,.online{display:none!important}h1{font-size:18pt}h2{font-size:14pt}h3{font-size:12pt}h1,h2,h3{break-after:avoid}p,li,tr,img,.evidence,.trial-entry,.decision-intro{break-inside:avoid}.copy{break-inside:auto}table{font-size:10pt;break-inside:avoid}.table{overflow:visible}small,.meta{font-size:9pt;color:#333}a{color:#000}.notice{background:none}thead{display:table-header-group}footer{font-size:9pt}}
`;

export function printReport(title: string, body: string, generatedAt = new Date().toISOString(), status = 200) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${reportText(title)}</title><style nonce="${nonce}">${css}</style></head><body><main>
    <nav class="toolbar"><button type="button" id="print-report">打印 / 保存为 PDF</button><a href="/">返回工作区</a><small>在打印窗口选择“另存为 PDF”。录音需登录后在线回放。</small></nav>
    ${body}<footer>记录截取时间：${reportText(sequenceTime(generatedAt))}。报告仅描述已保存的作品与人工记录，不作为正式能力等级认证。</footer>
    </main><script nonce="${nonce}">document.getElementById("print-report").addEventListener("click",function(){window.print();});</script></body></html>`;
  return new Response(html, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  } });
}

export function reportError(error: unknown) {
  const response = platformApiError(error);
  const message = response.status === 401 ? "登录已失效，请返回工作区重新登录后打开报告。"
    : response.status === 403 || response.status === 404 ? "当前无法访问这份报告，请返回工作区核对账号及授权范围。"
      : response.status === 400 ? "报告范围无效，请从工作区重新打开报告。" : "报告暂时无法生成，请稍后重试。";
  return printReport("报告暂不可用", `<h1>报告暂不可用</h1><p>${message}</p>`, undefined, response.status);
}

export function reportPasswordChangeGate(context: PlatformContext) {
  const gate = workspacePasswordChangeGate(getAuthMode(), context);
  return gate ? printReport("请先修改初始密码", "<h1>请先修改初始密码</h1><p>此账号需要先修改初始密码。请返回工作区完成修改，重新登录后再打开报告。</p>", undefined, gate.status) : null;
}
