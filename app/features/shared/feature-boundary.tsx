import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** 分块加载失败只影响对应功能，导航和其他编辑区仍可使用。 */
export class FeatureBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("功能页面加载失败", error, info.componentStack); }
  render() {
    if (this.state.failed) return <div className="my-6 rounded-xl border border-destructive/30 bg-card p-6" role="alert">
      <p className="font-medium">页面未能加载</p>
      <p className="mt-2 text-sm text-muted-foreground">请检查网络后重新加载网站。重新加载会清除尚未保存的输入。</p>
      <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>重新加载网站</Button>
    </div>;
    return this.props.children;
  }
}
