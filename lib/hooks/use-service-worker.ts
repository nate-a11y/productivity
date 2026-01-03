"use client";

import { useEffect, useState } from "react";

export function useServiceWorker() {
  const [isRegistered, setIsRegistered] = useState(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Register service worker
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        setRegistration(reg);
        setIsRegistered(true);

        // Check for updates
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New content available
              setIsUpdateAvailable(true);
            }
          });
        });
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });

    // Handle controller change (when a new SW takes over)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Reload to get fresh content
      window.location.reload();
    });
  }, []);

  function update() {
    if (!registration?.waiting) return;

    // Tell waiting SW to take over
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return {
    isRegistered,
    isUpdateAvailable,
    update,
  };
}
