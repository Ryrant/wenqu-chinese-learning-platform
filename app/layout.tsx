import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "文趣 · 华文趣味教学助手";
const description = "面向华文学校的多模态 AI 教学平台，让每一次开口、阅读和书写都成为有反馈的成长。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "wenqu.local";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = new URL("/og.png", origin).toString();
  return {
    metadataBase: new URL(origin),
    title: { default: title, template: "%s · 文趣" },
    description,
    applicationName: "文趣",
    keywords: ["华文教育", "AI教学", "口语陪练", "学情分析", "文化学习"],
    openGraph: { title, description: "诊断、学习、反馈、成长，一个平台打通华文教学全流程。", type: "website", locale: "zh_CN", images: [{ url: image, width: 1672, height: 941, alt: "文趣华文教学助手" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}