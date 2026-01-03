"use client";

import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACHIEVEMENTS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Achievement } from "@/lib/supabase/types";

interface AchievementBadgeProps {
  achievement: Achievement;
  compact?: boolean;
}

export function AchievementBadge({ achievement, compact }: AchievementBadgeProps) {
  const achievementDef = Object.values(ACHIEVEMENTS).find(
    a => a.id === achievement.achievement_type
  );

  if (!achievementDef) return null;

  const tierIndex = (achievementDef.tiers as readonly number[]).indexOf(achievement.achievement_tier);
  const tierLabels = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"];
  const tierLabel = tierLabels[tierIndex] || `Tier ${tierIndex + 1}`;
  const tierColors = [
    "bg-orange-500/10 text-orange-500",
    "bg-slate-400/10 text-slate-400",
    "bg-yellow-500/10 text-yellow-500",
    "bg-cyan-400/10 text-cyan-400",
    "bg-blue-500/10 text-blue-500",
    "bg-purple-500/10 text-purple-500",
  ];

  if (compact) {
    return (
      <div
        className={cn(
          "w-12 h-12 rounded-lg flex items-center justify-center text-2xl",
          tierColors[tierIndex] || tierColors[0]
        )}
        title={`${achievementDef.name} (${tierLabel})`}
      >
        {achievementDef.icon}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div
          className={cn(
            "w-14 h-14 rounded-xl flex items-center justify-center text-3xl",
            tierColors[tierIndex] || tierColors[0]
          )}
        >
          {achievementDef.icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium">{achievementDef.name}</h4>
            <Badge variant="secondary" className="text-xs">
              {tierLabel}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{achievementDef.description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Earned {format(new Date(achievement.earned_at), "MMM d, yyyy")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
