import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "华文知行协同教学平台",
    short_name: "华文知行",
    description: "面向华文学校的多模态 AI 教学平台",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f5ee",
    theme_color: "#164c3d",
    lang: "zh-CN",
  };
}