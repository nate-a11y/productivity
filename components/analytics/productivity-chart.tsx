"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyBreakdown } from "@/lib/supabase/types";

interface ProductivityChartProps {
  data: DailyBreakdown[];
}

export function ProductivityChart({ data }: ProductivityChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    date: format(new Date(d.date), "MMM d"),
    focusHours: Math.round((d.focusMinutes / 60) * 10) / 10,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Productivity Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFocus" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="tasksCompleted"
                name="Tasks"
                stroke="#6366f1"
                fill="url(#colorTasks)"
              />
              <Area
                type="monotone"
                dataKey="focusHours"
                name="Focus (hrs)"
                stroke="#10b981"
                fill="url(#colorFocus)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
