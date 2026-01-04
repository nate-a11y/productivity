"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Square,
  ChevronUp,
  ChevronDown,
  Maximize2,
  GripHorizontal,
  PictureInPicture2,
  X
} from "lucide-react";
import { cn, formatTimerDisplay } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTimerStore } from "@/lib/hooks/use-timer";
import Link from "next/link";

interface FloatingTimerProps {
  onClose?: () => void;
  autoOpenPiP?: boolean;
}

// Check if Document Picture-in-Picture is supported
function isPiPSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "documentPictureInPicture" in window;
}

export function FloatingTimer({ onClose, autoOpenPiP = false }: FloatingTimerProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [pipSupported, setPipSupported] = useState(false);
  const [pipError, setPipError] = useState<string | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const hasTriedAutoPiP = useRef(false);

  const {
    state,
    sessionType,
    timeRemaining,
    initialTime,
    task,
    pauseTimer,
    resumeTimer,
    stopTimer,
  } = useTimerStore();

  // Check PiP support on mount
  useEffect(() => {
    setPipSupported(isPiPSupported());
  }, []);

  // Open Picture-in-Picture window
  const openPiP = useCallback(async () => {
    if (!isPiPSupported()) {
      setPipError("Your browser doesn't support Picture-in-Picture");
      return false;
    }

    try {
      // Close existing PiP window if any
      if (pipWindow) {
        pipWindow.close();
      }

      // @ts-expect-error - Document PiP API types not yet in TS
      const pip: Window = await window.documentPictureInPicture.requestWindow({
        width: 320,
        height: 220,
        disallowReturnToOpener: false,
      });

      // Set up the PiP document
      pip.document.documentElement.style.colorScheme = "dark";

      // Add basic styles directly
      const style = pip.document.createElement("style");
      style.textContent = `
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: system-ui, -apple-system, sans-serif;
          background: #0a0a0a;
          color: white;
          padding: 16px;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .progress-bar {
          height: 4px;
          background: #27272a;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .progress-fill {
          height: 100%;
          transition: width 0.5s ease;
        }
        .progress-fill.focus { background: #f97316; }
        .progress-fill.break { background: #22c55e; }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .badge {
          font-size: 11px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 9999px;
        }
        .badge.focus { background: rgba(249,115,22,0.2); color: #fb923c; }
        .badge.break { background: rgba(34,197,94,0.2); color: #4ade80; }
        .close-btn {
          background: none;
          border: none;
          color: #71717a;
          cursor: pointer;
          padding: 4px;
          font-size: 14px;
        }
        .close-btn:hover { color: white; }
        .timer {
          text-align: center;
          font-family: ui-monospace, monospace;
          font-size: 48px;
          font-weight: 700;
          letter-spacing: -2px;
          margin: 8px 0;
        }
        .timer.running { color: #f97316; }
        .timer.paused { color: #71717a; }
        .task-name {
          text-align: center;
          font-size: 12px;
          color: #a1a1aa;
          margin-bottom: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .controls {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-top: auto;
        }
        .btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.15s;
        }
        .btn-icon {
          width: 36px;
          height: 36px;
          background: transparent;
          border: 1px solid #3f3f46;
          color: #a1a1aa;
        }
        .btn-icon:hover { background: #27272a; color: white; }
        .btn-primary {
          height: 36px;
          padding: 0 16px;
          background: #f97316;
          color: white;
        }
        .btn-primary:hover { background: #ea580c; }
        .btn-primary.paused { background: #22c55e; }
        .btn-primary.paused:hover { background: #16a34a; }
        svg {
          width: 16px;
          height: 16px;
        }
      `;
      pip.document.head.appendChild(style);

      // Create container for content
      const container = pip.document.createElement("div");
      container.id = "pip-root";
      pip.document.body.appendChild(container);

      setPipWindow(pip);
      setPipContainer(container);
      setPipError(null);

      // Handle PiP window close
      pip.addEventListener("pagehide", () => {
        setPipWindow(null);
        setPipContainer(null);
      });

      return true;
    } catch (error) {
      console.error("Failed to open PiP:", error);
      setPipError(error instanceof Error ? error.message : "Failed to open Picture-in-Picture");
      return false;
    }
  }, [pipWindow]);

  // Only show when timer is active
  const isActive = state === "running" || state === "paused" || state === "break";

  // Auto-open PiP when timer becomes active (only once per session)
  useEffect(() => {
    if (autoOpenPiP && isActive && !pipWindow && !hasTriedAutoPiP.current && pipSupported) {
      hasTriedAutoPiP.current = true;
      // Small delay to ensure user gesture context is available
      const timer = setTimeout(() => {
        openPiP();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [autoOpenPiP, isActive, pipWindow, pipSupported, openPiP]);

  // Reset auto-PiP flag when timer stops
  useEffect(() => {
    if (!isActive) {
      hasTriedAutoPiP.current = false;
    }
  }, [isActive]);

  // Close PiP when timer stops
  useEffect(() => {
    if (!isActive && pipWindow) {
      pipWindow.close();
      setPipWindow(null);
      setPipContainer(null);
    }
  }, [isActive, pipWindow]);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;

    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  // Handle drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;

      const newX = Math.max(0, Math.min(window.innerWidth - 200, dragStartRef.current.posX + deltaX));
      const newY = Math.max(0, Math.min(window.innerHeight - 100, dragStartRef.current.posY + deltaY));

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Calculate progress
  const progress = initialTime > 0 ? ((initialTime - timeRemaining) / initialTime) * 100 : 0;

  // Don't render in-browser widget if PiP is open
  if (pipWindow && pipContainer) {
    return createPortal(
      <PiPTimerContent
        state={state}
        sessionType={sessionType}
        timeRemaining={timeRemaining}
        initialTime={initialTime}
        task={task}
        pauseTimer={pauseTimer}
        resumeTimer={resumeTimer}
        stopTimer={stopTimer}
        onClose={() => pipWindow.close()}
      />,
      pipContainer
    );
  }

  if (!isActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={dragRef}
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: 20 }}
        className={cn(
          "fixed z-50 bg-card border rounded-xl shadow-2xl",
          isDragging ? "cursor-grabbing" : "cursor-grab",
          "select-none"
        )}
        style={{
          left: position.x,
          bottom: position.y,
        }}
      >
        {/* Progress bar at top */}
        <div className="h-1 bg-muted rounded-t-xl overflow-hidden">
          <motion.div
            className={cn(
              "h-full",
              sessionType === "focus" ? "bg-primary" : "bg-green-500"
            )}
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Drag handle */}
        <div
          className="flex items-center justify-center py-1 border-b border-border/50 hover:bg-muted/50 transition-colors"
          onMouseDown={handleMouseDown}
        >
          <GripHorizontal className="h-3 w-3 text-muted-foreground" />
        </div>

        {/* Content */}
        <div className="p-3">
          {isCollapsed ? (
            // Collapsed view - just timer
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "font-mono text-lg font-bold tabular-nums",
                  state === "running" && "text-primary"
                )}
              >
                {formatTimerDisplay(timeRemaining)}
              </span>
              <div className="flex items-center gap-1">
                {state === "paused" ? (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={resumeTimer}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={pauseTimer}>
                    <Pause className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setIsCollapsed(false)}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            // Expanded view
            <div className="space-y-3 min-w-[200px]">
              {/* Session type badge */}
              <div className="flex items-center justify-between">
                <span className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  sessionType === "focus"
                    ? "bg-primary/10 text-primary"
                    : "bg-green-500/10 text-green-500"
                )}>
                  {sessionType === "focus" ? "Focus" : sessionType === "short_break" ? "Break" : "Long Break"}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => setIsCollapsed(true)}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  {pipSupported && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={openPiP}
                      title="Pop out window (stays on top of other apps)"
                    >
                      <PictureInPicture2 className="h-3 w-3" />
                    </Button>
                  )}
                  <Link href="/focus">
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="Open full timer">
                      <Maximize2 className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </div>

              {/* PiP Error */}
              {pipError && (
                <p className="text-xs text-red-400 text-center">{pipError}</p>
              )}

              {/* Timer display */}
              <div className="text-center">
                <span
                  className={cn(
                    "font-mono text-3xl font-bold tabular-nums",
                    state === "running" && "text-primary",
                    state === "paused" && "opacity-70"
                  )}
                >
                  {formatTimerDisplay(timeRemaining)}
                </span>
              </div>

              {/* Task name */}
              {task && (
                <p className="text-xs text-muted-foreground text-center truncate px-2">
                  {task.title}
                </p>
              )}

              {/* Controls */}
              <div className="flex items-center justify-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={stopTimer}
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
                {state === "paused" ? (
                  <Button size="sm" className="h-8 px-4" onClick={resumeTimer}>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Resume
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 px-4" onClick={pauseTimer}>
                    <Pause className="h-3.5 w-3.5 mr-1.5" />
                    Pause
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Simplified timer content for PiP window (vanilla HTML/JS - no React)
function PiPTimerContent({
  state,
  sessionType,
  timeRemaining,
  initialTime,
  task,
  pauseTimer,
  resumeTimer,
  stopTimer,
  onClose,
}: {
  state: string;
  sessionType: string;
  timeRemaining: number;
  initialTime: number;
  task: { title: string } | null;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => void;
  onClose: () => void;
}) {
  const progress = initialTime > 0 ? ((initialTime - timeRemaining) / initialTime) * 100 : 0;
  const isFocus = sessionType === "focus";
  const isPaused = state === "paused";

  // SVG icons as strings
  const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  const pauseIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
  const stopIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      dangerouslySetInnerHTML={{
        __html: `
          <div class="progress-bar">
            <div class="progress-fill ${isFocus ? 'focus' : 'break'}" style="width: ${progress}%"></div>
          </div>

          <div class="header">
            <span class="badge ${isFocus ? 'focus' : 'break'}">
              ${isFocus ? 'Focus' : sessionType === 'short_break' ? 'Break' : 'Long Break'}
            </span>
            <button class="close-btn" onclick="window.close()">✕</button>
          </div>

          <div class="timer ${state === 'running' ? 'running' : 'paused'}">
            ${formatTimerDisplay(timeRemaining)}
          </div>

          ${task ? `<div class="task-name">${task.title}</div>` : ''}

          <div class="controls">
            <button class="btn btn-icon" id="stop-btn">${stopIcon}</button>
            <button class="btn btn-primary ${isPaused ? 'paused' : ''}" id="toggle-btn">
              ${isPaused ? playIcon : pauseIcon}
              ${isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        `
      }}
      ref={(el) => {
        if (el) {
          const stopBtn = el.querySelector('#stop-btn');
          const toggleBtn = el.querySelector('#toggle-btn');

          if (stopBtn) {
            stopBtn.addEventListener('click', () => {
              stopTimer();
              onClose();
            });
          }

          if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
              if (isPaused) {
                resumeTimer();
              } else {
                pauseTimer();
              }
            });
          }
        }
      }}
    />
  );
}
