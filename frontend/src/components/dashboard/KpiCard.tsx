import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function KpiCard({ title, value, subtext, icon, badge, className }: KpiCardProps) {
  return (
    <Card className={cn("h-full border-border/60 bg-card shadow-sm", className)}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground truncate">{title}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold tabular-nums leading-none text-foreground truncate">
              {value}
            </span>
            {badge}
          </div>
          {subtext ? (
            <p className="text-[11px] text-muted-foreground truncate">{subtext}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
