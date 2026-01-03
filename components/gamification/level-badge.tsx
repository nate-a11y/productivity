"use client";

import { Star } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { LEVELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface LevelBadgeProps {
  totalPoints: number;
  showProgress?: boolean;
  size?: "sm" | "md" | "lg";
}

export function LevelBadge({ totalPoints, showProgress, size = "md" }: LevelBadgeProps) {
  const currentLevel = LEVELS.reduce((acc, level) => {
    if (totalPoints >= level.pointsRequired) return level;
    return acc;
  }, LEVELS[0]);

  const nextLevel = LEVELS.find(l => l.level === currentLevel.level + 1);

  const progressToNext = nextLevel
    ? ((totalPoints - currentLevel.pointsRequired) / (nextLevel.pointsRequired - currentLevel.pointsRequired)) * 100
    : 100;

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-12 h-12 text-sm",
    lg: "w-16 h-16 text-lg",
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "rounded-full flex items-center justify-center font-bold",
          sizeClasses[size]
        )}
        style={{ backgroundColor: `${currentLevel.color}20`, color: currentLevel.color }}
      >
        {currentLevel.level}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{currentLevel.name}</span>
          <Star className="h-4 w-4" style={{ color: currentLevel.color }} />
        </div>
        {showProgress && nextLevel && (
          <div className="mt-1">
            <Progress value={progressToNext} className="h-1.5" />
            <p className="text-xs text-muted-foreground mt-1">
              {totalPoints} / {nextLevel.pointsRequired} XP to {nextLevel.name}
            </p>
          </div>
        )}
        {showProgress && !nextLevel && (
          <p className="text-xs text-muted-foreground mt-1">Max level reached!</p>
        )}
      </div>
    </div>
  );
}
