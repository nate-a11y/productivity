import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, AlertCircle, CheckCircle } from "lucide-react";
import Link from "next/link";
import { AcceptInviteButton } from "./accept-button";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const supabase = await createClient() as any;

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch invitation
  const { data: invitation } = await supabase
    .from("zeroed_team_invitations")
    .select(`
      id,
      email,
      role,
      expires_at,
      accepted_at,
      zeroed_teams (
        id,
        name,
        slug,
        description,
        avatar_url
      )
    `)
    .eq("token", token)
    .single();

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Invitation</h2>
            <p className="text-muted-foreground mb-6">
              This invitation link is invalid or has been removed.
            </p>
            <Button asChild>
              <Link href="/login">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if expired
  if (new Date(invitation.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invitation Expired</h2>
            <p className="text-muted-foreground mb-6">
              This invitation has expired. Please ask the team admin to send a new one.
            </p>
            <Button asChild>
              <Link href="/login">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if already accepted
  if (invitation.accepted_at) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Already Accepted</h2>
            <p className="text-muted-foreground mb-6">
              This invitation has already been accepted.
            </p>
            <Button asChild>
              <Link href={`/teams/${invitation.zeroed_teams.slug}`}>
                Go to Team
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const team = invitation.zeroed_teams;

  // If not logged in, redirect to login with return URL
  if (!user) {
    redirect(`/login?redirect=/invite/${token}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Join {team.name}</CardTitle>
          <CardDescription>
            You've been invited to join this team as a <strong>{invitation.role}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {team.description && (
            <p className="text-sm text-muted-foreground text-center">
              {team.description}
            </p>
          )}

          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            <p className="font-medium mb-2">What you'll be able to do:</p>
            <ul className="space-y-1 text-muted-foreground">
              {invitation.role === "admin" && (
                <>
                  <li>• Manage team settings and members</li>
                  <li>• Create and manage projects</li>
                  <li>• Assign and complete tasks</li>
                </>
              )}
              {invitation.role === "member" && (
                <>
                  <li>• Create and manage projects</li>
                  <li>• Create and complete tasks</li>
                  <li>• Comment on tasks</li>
                </>
              )}
              {invitation.role === "viewer" && (
                <>
                  <li>• View team projects and tasks</li>
                  <li>• Comment on tasks</li>
                </>
              )}
            </ul>
          </div>

          <AcceptInviteButton token={token} teamSlug={team.slug} />
        </CardContent>
      </Card>
    </div>
  );
}
