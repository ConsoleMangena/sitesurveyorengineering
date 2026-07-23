import * as React from "react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon: React.ReactNode;
  className?: string;
}

export function KpiCard({ title, value, subtext, icon, className }: KpiCardProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle className="font-normal text-muted-foreground text-sm">{title}</CardTitle>
        <CardDescription className="text-2xl text-foreground tabular-nums leading-none tracking-tight">
          {value}
        </CardDescription>
        <CardAction className="grid size-7 place-items-center rounded-md bg-muted">
          {icon}
        </CardAction>
      </CardHeader>
      {subtext ? <CardContent className="text-sm">{subtext}</CardContent> : null}
    </Card>
  );
}
