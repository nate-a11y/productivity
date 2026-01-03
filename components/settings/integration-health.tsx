"use client";

import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle, RefreshCw, XCircle, RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface HealthStatus {
  provider: string;
  connected: boolean;
  healthy: boolean;
  error?: string;
  lastSync?: string | null;
  lastSyncError?: {
    message: string;
    timestamp: string;
  } | null;
}

const providerNames: Record<string, string> = {
  google_calendar: "Google Calendar",
  slack: "Slack",
  notion: "Notion",
};

const syncEndpoints: Record<string, string> = {
  google_calendar: "/api/integrations/google/sync",
  notion: "/api/integrations/notion/sync",
};

export function IntegrationHealth() {
  const [health, setHealth] = useState<HealthStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryingProvider, setRetryingProvider] = useState<string | null>(null);

  async function checkHealth() {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/integrations/health");
      const data = await res.json();
      if (data.health) {
        setHealth(data.health);
      }
    } catch {
      toast.error("Failed to check health");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  async function retrySync(provider: string) {
    const endpoint = syncEndpoints[provider];
    if (!endpoint) return;

    setRetryingProvider(provider);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Sync failed");
      }

      toast.success(data.message || "Sync successful!");
      await checkHealth(); // Refresh health status
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setRetryingProvider(null);
    }
  }

  useEffect(() => {
    checkHealth();
  }, []);

  const connectedIntegrations = health.filter((h) => h.connected);
  const unhealthyCount = connectedIntegrations.filter((h) => !h.healthy).length;

  if (isLoading) {
    return null;
  }

  if (connectedIntegrations.length === 0) {
    return null;
  }

  return (
    <Card className={unhealthyCount > 0 ? "border-destructive/50" : "border-green-500/50"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {unhealthyCount > 0 ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle className="h-5 w-5 text-green-500" />
            )}
            <CardTitle className="text-base">Integration Health</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={checkHealth}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription>
          {unhealthyCount > 0
            ? `${unhealthyCount} integration${unhealthyCount > 1 ? "s" : ""} need attention`
            : "All integrations are working"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {connectedIntegrations.map((status) => (
            <div
              key={status.provider}
              className={`p-2 rounded-lg ${
                status.healthy ? "bg-muted/50" : "bg-destructive/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {status.healthy ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-medium">
                    {providerNames[status.provider] || status.provider}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {status.healthy ? (
                      status.lastSync ? (
                        `Last sync: ${new Date(status.lastSync).toLocaleDateString()}`
                      ) : (
                        "Connected"
                      )
                    ) : (
                      <span className="text-destructive">{status.error}</span>
                    )}
                  </span>
                  {!status.healthy && syncEndpoints[status.provider] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => retrySync(status.provider)}
                      disabled={retryingProvider === status.provider}
                    >
                      <RotateCcw
                        className={`h-3 w-3 ${
                          retryingProvider === status.provider ? "animate-spin" : ""
                        }`}
                      />
                      <span className="ml-1 text-xs">Retry</span>
                    </Button>
                  )}
                </div>
              </div>
              {status.lastSyncError && (
                <p className="text-xs text-muted-foreground mt-1 pl-6 truncate" title={status.lastSyncError.message}>
                  Last error: {status.lastSyncError.message}
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
