import { Activity, Suspense, useState, type ReactNode } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { FeatureBoundary } from "./feature-boundary";

/** 首次访问才加载功能；离开时保留草稿及请求标识，返回后继续编辑。 */
export function RetainedFeature({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;
  return <Activity mode={active ? "visible" : "hidden"}>
    <FeatureBoundary><Suspense fallback={<p className="py-6 text-sm text-muted-foreground" role="status">正在加载页面…</p>}>
      {children}
    </Suspense></FeatureBoundary>
  </Activity>;
}

export function RetainedTabsContent({ active, value, children, className }: {
  active: boolean; value: string; children: ReactNode; className?: string;
}) {
  return <TabsContent forceMount value={value} className={`data-[state=inactive]:hidden ${className ?? ""}`}>
    <RetainedFeature active={active}>{children}</RetainedFeature>
  </TabsContent>;
}
