import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface MetricStripMetric {
  label: string;
  value: string;
  subtext?: string;
  accentColor: string;
  /** Optional custom icon node. If omitted, falls back to a simple dot. */
  icon?: React.ReactNode;
  /** Optional handler for clickable metrics. Adds button semantics and hover cursor. */
  onClick?: () => void;
}

interface MetricStripProps {
  metrics: MetricStripMetric[];
  loading?: boolean;
  compact?: boolean;
}

function DefaultIcon({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color }}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function MetricSkeleton({ compact }: { compact?: boolean }) {
  return (
    <Card className="border-border/60">
      <CardContent className={cn("flex items-center", compact ? "gap-2 p-2" : "gap-3 sm:gap-4 p-3 sm:p-5")}>
        <Skeleton className={cn("rounded-lg", compact ? "h-7 w-7" : "h-8 w-8 sm:h-10 sm:w-10")} />
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className={cn(compact ? "h-4 w-12" : "h-5 sm:h-6 w-14 sm:w-16")} />
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricStrip({ metrics, loading = false, compact = false }: MetricStripProps) {
  if (loading) {
    return (
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", compact ? "gap-2" : "gap-3 sm:gap-4")}>
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricSkeleton key={i} compact={compact} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("grid", compact ? "gap-2" : "gap-3 sm:gap-4")}
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
      }}
    >
      {metrics.map((metric, index) => {
        const clickable = !!metric.onClick;
        return (
          <Card
            key={metric.label + index}
            className={cn(
              "border-border/60 transition-all duration-200 group relative overflow-hidden",
              clickable && "cursor-pointer hover:shadow-md hover:-translate-y-0.5",
            )}
            onClick={metric.onClick}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      metric.onClick?.();
                    }
                  }
                : undefined
            }
          >
            <CardContent className={cn("flex items-center", compact ? "gap-2 p-2" : "gap-3 sm:gap-4 p-3 sm:p-5")}>
              <div
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110",
                  compact ? "h-7 w-7" : "h-8 w-8 sm:h-10 sm:w-10",
                )}
                style={{
                  background: `${metric.accentColor}18`,
                  color: metric.accentColor,
                }}
                aria-hidden="true"
              >
                {metric.icon ? (
                  <span className="flex items-center justify-center">
                    {metric.icon}
                  </span>
                ) : (
                  <DefaultIcon color={metric.accentColor} />
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
                  {metric.label}
                </span>
                <span
                  className={cn(
                    "font-bold text-foreground truncate",
                    compact ? "text-sm sm:text-base" : "text-base sm:text-lg md:text-xl",
                  )}
                  title={metric.value}
                >
                  {metric.value}
                </span>
                {metric.subtext && (
                  <span className="text-[10px] sm:text-xs text-muted-foreground truncate">
                    {metric.subtext}
                  </span>
                )}
              </div>
            </CardContent>
            <div
              className="absolute bottom-0 left-0 right-0 h-[3px] transition-transform duration-300 origin-left scale-x-0 group-hover:scale-x-100"
              style={{ background: metric.accentColor }}
              aria-hidden="true"
            />
          </Card>
        );
      })}
    </div>
  );
}
