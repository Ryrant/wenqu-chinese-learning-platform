import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return <header className="page-header"><div>{eyebrow && <p className="page-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <div className="page-description">{description}</div>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function SectionHeading({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function StatCard({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode }) {
  return <Card className="stat-card"><CardContent><div className="stat-label">{label}{icon}</div><div className="stat-value">{value}</div>{detail && <div className="stat-detail">{detail}</div>}</CardContent></Card>;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-state-title">{title}</div>{description && <p>{description}</p>}{action && <div>{action}</div>}</div>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  return <span className={cn("status-badge", `status-badge-${tone}`)}>{children}</span>;
}

export function MetricGrid({ items }: { items: Array<[string, string | number]> }) {
  return <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map(([label, value]) => <StatCard key={label} label={label} value={value}/>)}</section>;
}
