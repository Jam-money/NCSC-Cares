import type { ComponentType, ReactNode } from "react";

export function PageHeader({ icon: Icon, title, subtitle, children }: {
  icon: ComponentType<{ className?: string }>; title: string; subtitle?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl gradient-primary text-white shadow-md">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
