import { useRef, useState } from "react";
import { numberValue, stringValue } from "@/app/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, EmptyState, SectionHeading } from "@/app/components/workspace-ui";
import type { AdminProps } from "@/app/features/shared/staff-display";
import { MetricGrid } from "@/app/features/shared/staff-display";

const PROCESSING_LABELS: Record<string, string> = {
  uploaded: "已上传",
  processed: "待发布审核",
  published: "已发布",
  rejected: "未通过",
  failed: "处理失败",
  archived: "已归档",
};

const RIGHTS_LABELS: Record<string, string> = { pending: "待权属核验", owned: "机构自有", licensed: "已获授权", approved: "权属已确认" };

export function ContentPage({ data, act, refresh, notify }: AdminProps) {
const [uploading, setUploading] = useState(false);
const [uploadOpen, setUploadOpen] = useState(false);
const contentDialogTrigger = useRef<HTMLButtonElement | null>(null);
const uploadTrigger = useRef<HTMLButtonElement | null>(null);
const [file, setFile] = useState<File | null>(null);
const [rights, setRights] = useState("pending");
const [selectedDocumentId, setSelectedDocumentId] = useState("");
const selectedDocument = data.documents.find((item) => String(item.id) === selectedDocumentId);
async function upload(event: React.FormEvent) {
    event.preventDefault(); if (!file) return; setUploading(true);
    try {
      const form = new FormData(); form.append("file", file); form.append("rightsStatus", rights);
      const response = await fetch("/api/v1/content/upload", { method: "POST", body: form }); const result = await response.json() as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error);
      setFile(null); setUploadOpen(false);
      if (result.status === "failed") {
        notify("资料处理失败", result.error === "unsupported_scanned_pdf" ? "原文件已保存，但未提取到可用文字。请更换可检索的文本型 PDF。" : "原文件已保存，处理失败原因可在资料列表查看。无需重复上传。", "error");
      } else {
        notify("资料已上传", "等待完成权属核验和发布审核。");
      }
      try { await refresh(); }
      catch (reason) { notify("资料已保存", `列表刷新失败：${reason instanceof Error ? reason.message : "请刷新页面"}，请勿重复上传。`, "error"); }
    } catch (reason) { notify("上传失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setUploading(false); }
  }
return <section key="content-center" className="space-y-6">
    <PageHeader title="内容中心" description="管理教学资料、内容审核与知识片段。" actions={<Button ref={uploadTrigger} type="button" onClick={(event) => { contentDialogTrigger.current = event.currentTarget; setUploadOpen(true); }}>上传资料</Button>}/>
    <MetricGrid items={[["全部资料", data.documents.length], ["已发布", data.documents.filter((item) => item.processing_status === "published").length], ["待审核", data.documents.filter((item) => item.processing_status === "processed").length], ["知识片段", data.documents.reduce((sum, item) => sum + numberValue(item.chunkCount), 0)]]}/>
    <Card className="panel content-pipeline"><SectionHeading title="教学资料库"/>
      {data.documents.length ? <Table><TableHeader><TableRow><TableHead>资料</TableHead><TableHead>状态</TableHead><TableHead>权属</TableHead><TableHead>片段</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{data.documents.map((item) => {
        const processingError = stringValue(item.processingError, "");
        const canReprocess = Boolean(item.object_key) && /pdf|wordprocessingml|text\//.test(stringValue(item.media_type, ""));
        return <TableRow key={String(item.id)}><TableCell className="min-w-48"><p className="font-medium">{stringValue(item.title)}</p>{processingError && <p className="mt-1 max-w-sm whitespace-normal text-xs text-destructive">{processingError === "unsupported_scanned_pdf" ? "扫描版 PDF 暂不支持提取，请上传可检索文本版。" : processingError}</p>}</TableCell><TableCell><Badge variant={item.processing_status === "published" ? "secondary" : "outline"}>{PROCESSING_LABELS[stringValue(item.processing_status)] ?? stringValue(item.processing_status)}</Badge></TableCell><TableCell>{RIGHTS_LABELS[stringValue(item.rights_status)] ?? stringValue(item.rights_status)}</TableCell><TableCell>{numberValue(item.chunkCount)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="sm" onClick={(event) => { contentDialogTrigger.current = event.currentTarget; setSelectedDocumentId(String(item.id)); }}>查看片段</Button><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`${stringValue(item.title)}的更多操作`}>…</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          {item.processing_status === "processed" && <DropdownMenuItem onSelect={async () => { try { await act("review_content", { id: item.id, status: "published" }); notify("内容已发布", "可用于知识检索和来源化备课。"); } catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>审核并发布</DropdownMenuItem>}
          <DropdownMenuItem disabled={!canReprocess} onSelect={async () => { try { await act("reprocess_content", { id: item.id }); notify("资料已重新处理", "新片段需要再次完成发布审核。"); } catch (reason) { notify("重新处理失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>重新提取片段</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem className="text-destructive" onSelect={async () => { if (!window.confirm("归档后该资料将停止检索，是否继续？")) return; try { await act("archive_content", { id: item.id }); notify("资料已归档", "原文件和审计记录仍然保留。"); } catch (reason) { notify("归档失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>归档资料</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu></div></TableCell></TableRow>;
      })}</TableBody></Table> : <EmptyState title="尚无教学资料" description="上传 TXT、DOCX 或文本型 PDF，建立机构知识库。" action={<Button type="button" variant="outline" onClick={(event) => { contentDialogTrigger.current = event.currentTarget; setUploadOpen(true); }}>上传第一份资料</Button>}/>}
    </Card>
    <Dialog open={uploadOpen} onOpenChange={(open) => { if (!uploading) setUploadOpen(open); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (contentDialogTrigger.current?.isConnected ? contentDialogTrigger.current : uploadTrigger.current)?.focus(); }} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0"><form onSubmit={upload} className="flex min-h-0 flex-1 flex-col overflow-hidden"><DialogHeader className="shrink-0 border-b px-6 py-5"><DialogTitle>上传教学资料</DialogTitle><DialogDescription>资料通过权属核验和审核后，才能用于备课与检索。</DialogDescription></DialogHeader><div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5"><label className="grid gap-2 text-sm font-medium">资料文件<Input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.mp3,.wav,.webm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required/></label><label className="grid gap-2 text-sm font-medium">权属状态<NativeSelect className="w-full" value={rights} onChange={(event) => setRights(event.target.value)}><option value="pending">待权属核验</option><option value="owned">机构自有</option><option value="licensed">已获得授权</option></NativeSelect></label></div><DialogFooter className="mx-0 mb-0 shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" disabled={uploading} onClick={() => setUploadOpen(false)}>取消</Button><Button type="submit" disabled={uploading || !file}>{uploading ? "上传中…" : "上传资料"}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={!!selectedDocument} onOpenChange={(open) => { if (!open) setSelectedDocumentId(""); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (contentDialogTrigger.current?.isConnected ? contentDialogTrigger.current : uploadTrigger.current)?.focus(); }} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl"><DialogHeader className="shrink-0 border-b px-6 py-5"><DialogTitle>{stringValue(selectedDocument?.title)}</DialogTitle><DialogDescription>{numberValue(selectedDocument?.chunkCount)} 个片段 · 已发布 {numberValue(selectedDocument?.publishedChunkCount)} 个</DialogDescription></DialogHeader><div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">{Array.isArray(selectedDocument?.previewChunks) && selectedDocument.previewChunks.length ? selectedDocument.previewChunks.slice(0, 3).map((preview, index) => <section className="rounded-lg border p-4" key={index}><Badge variant="outline">片段 {index + 1}</Badge><p className="mt-3 whitespace-pre-wrap leading-relaxed">{stringValue(preview)}</p></section>) : <EmptyState title="尚无可预览的知识片段" description="处理完成后，片段会显示在这里。"/>}</div></DialogContent></Dialog>
  </section>;
}

export default ContentPage;
