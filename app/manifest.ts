import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "文趣 · 华文趣味教学助手",
    short_name: "文趣",
    description: "面向华文学校的多模态 AI 教学平台",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f5ee",
    theme_color: "#164c3d",
    lang: "zh-CN",
  };
}