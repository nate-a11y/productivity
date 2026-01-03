"use client";

import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface PointsDisplayProps {
  points: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  animated?: boolean;
}

export function PointsDisplay({ points, size = "md", showLabel, animated }: PointsDisplayProps) {
  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 font-medium",
        sizeClasses[size],
        animated && "animate-pulse"
      )}
    >
      <Zap className={cn(iconSizes[size], "text-yellow-500 fill-yellow-500")} />
      <span>{points.toLocaleString()}</span>
      {showLabel && <span className="text-muted-foreground font-normal">XP</span>}
    </div>
  );
}
