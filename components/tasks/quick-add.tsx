"use client";

import { useState, useRef, useCallback } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createQuickTask } from "@/app/(dashboard)/actions";
import { VoiceInput } from "./voice-input";

interface QuickAddProps {
  defaultListId: string;
  placeholder?: string;
  showHint?: boolean;
}

export function QuickAdd({
  defaultListId,
  placeholder = "Try: Call mom tomorrow at 3pm !high #personal",
  showHint = false,
}: QuickAddProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || isSubmitting) return;

    setIsSubmitting(true);
    const result = await createQuickTask(value.trim(), defaultListId);
    setIsSubmitting(false);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Added. Get it done.");
      setValue("");
      // Keep focus for rapid entry
      inputRef.current?.focus();
    }
  }

  const handleVoiceResult = useCallback((text: string) => {
    setValue((prev) => (prev ? `${prev} ${text}` : text));
    inputRef.current?.focus();
  }, []);

  const handleInterimResult = useCallback((text: string) => {
    // Show interim results as placeholder
  }, []);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1 flex gap-1">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="pr-10"
          disabled={isSubmitting}
        />
        {isSubmitting && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        <VoiceInput
          onResult={handleVoiceResult}
          onInterimResult={handleInterimResult}
          disabled={isSubmitting}
        />
      </div>
      <Button type="submit" disabled={isSubmitting || !value.trim()}>
        <Plus className="h-4 w-4 mr-1" />
        Add
      </Button>
    </form>
  );
}
