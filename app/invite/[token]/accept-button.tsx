"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle } from "lucide-react";

interface AcceptInviteButtonProps {
  token: string;
  teamSlug: string;
}

export function AcceptInviteButton({ token, teamSlug }: AcceptInviteButtonProps) {
  const router = useRouter();
  const [isAccepting, setIsAccepting] = useState(false);

  async function handleAccept() {
    setIsAccepting(true);
    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Welcome to the team!");
      router.push(`/teams/${teamSlug}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to accept invitation");
      setIsAccepting(false);
    }
  }

  return (
    <Button className="w-full" size="lg" onClick={handleAccept} disabled={isAccepting}>
      <CheckCircle className="h-4 w-4 mr-2" />
      {isAccepting ? "Joining..." : "Accept Invitation"}
    </Button>
  );
}
