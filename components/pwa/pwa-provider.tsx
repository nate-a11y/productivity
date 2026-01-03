"use client";

import { useServiceWorker } from "@/lib/hooks/use-service-worker";
import { InstallPrompt } from "./install-prompt";
import { OfflineIndicator } from "./offline-indicator";
import { UpdatePrompt } from "./update-prompt";

export function PWAProvider({ children }: { children: React.ReactNode }) {
  const { isUpdateAvailable, update } = useServiceWorker();

  return (
    <>
      {children}
      <OfflineIndicator />
      <InstallPrompt />
      {isUpdateAvailable && <UpdatePrompt onUpdate={update} />}
    </>
  );
}
