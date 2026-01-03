"use client";

import { TrendingUp, TrendingDown, Target, Clock, Zap, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProductivityMetrics } from "@/lib/supabase/types";

interface MetricsOverviewProps {
  metrics: ProductivityMetrics;
}

export function MetricsOverview({ metrics }: MetricsOverviewProps) {
  const cards = [
    {
      title: "Tasks Completed",
      value: metrics.tasksCompleted,
      trend: metrics.tasksCompletedTrend,
      icon: Target,
      format: (v: number) => v.toString(),
    },
    {
      title: "Focus Time",
      value: metrics.focusMinutes,
      trend: metrics.focusMinutesTrend,
      icon: Clock,
      format: (v: number) => `${Math.floor(v / 60)}h ${v % 60}m`,
    },
    {
      title: "Completion Rate",
      value: metrics.completionRate,
      icon: Zap,
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    {
      title: "Current Streak",
      value: metrics.currentStreak,
      icon: Flame,
      format: (v: number) => `${v} days`,
      highlight: metrics.currentStreak >= 7,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon
              className={cn(
                "h-4 w-4 text-muted-foreground",
                card.highlight && "text-orange-500"
              )}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.format(card.value)}</div>
            {card.trend !== undefined && card.trend !== 0 && (
              <p
                className={cn(
                  "text-xs flex items-center gap-1",
                  card.trend > 0
                    ? "text-green-500"
                    : card.trend < 0
                    ? "text-red-500"
                    : "text-muted-foreground"
                )}
              >
                {card.trend > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {Math.abs(Math.round(card.trend * 100))}% vs previous
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
