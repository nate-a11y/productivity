"use client";

import { useState } from "react";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface SyncError {
  message: string;
  timestamp: string;
  provider: string;
  operation: string;
}

interface SyncErrorDisplayProps {
  error: SyncError | null;
  onRetry: () => Promise<void>;
  onDismiss: () => void;
}

export function SyncErrorDisplay({ error, onRetry, onDismiss }: SyncErrorDisplayProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  if (!error) return null;

  const timeAgo = getTimeAgo(new Date(error.timestamp));

  async function handleRetry() {
    setIsRetrying(true);
    try {
      await onRetry();
      toast.success("Sync successful!");
      onDismiss();
    } catch {
      toast.error("Sync failed again");
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
      <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-destructive">Sync failed</p>
        <p className="text-xs text-muted-foreground truncate" title={error.message}>
          {error.message}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{timeAgo}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRetry}
          disabled={isRetrying}
          className="h-8 px-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
          <span className="ml-1">{isRetrying ? "Retrying..." : "Retry"}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
