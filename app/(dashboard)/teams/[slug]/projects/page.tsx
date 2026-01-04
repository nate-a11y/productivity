import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/dashboard/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FolderKanban, Plus, ArrowRight } from "lucide-react";
import Link from "next/link";

interface ProjectsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const { slug } = await params;
  const supabase = await createClient() as any;
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get team
  const { data: team } = await supabase
    .from("zeroed_teams")
    .select("id, name")
    .eq("slug", slug)
    .single();

  if (!team) {
    notFound();
  }

  // Check membership
  const { data: membership } = await supabase
    .from("zeroed_team_members")
    .select("role")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    notFound();
  }

  // Fetch projects with task counts
  const { data: projects } = await supabase
    .from("zeroed_team_projects")
    .select("*")
    .eq("team_id", team.id)
    .order("position", { ascending: true });

  // Get task counts for each project
  const projectsWithCounts = await Promise.all(
    (projects || []).map(async (project: any) => {
      const { count: totalTasks } = await supabase
        .from("zeroed_team_tasks")
        .select("*", { count: "exact", head: true })
        .eq("project_id", project.id);

      const { count: completedTasks } = await supabase
        .from("zeroed_team_tasks")
        .select("*", { count: "exact", head: true })
        .eq("project_id", project.id)
        .eq("status", "completed");

      return {
        ...project,
        totalTasks: totalTasks || 0,
        completedTasks: completedTasks || 0,
      };
    })
  );

  const canManage = ["owner", "admin", "member"].includes(membership.role);

  return (
    <div className="flex flex-col h-full">
      <Header
        title={`${team.name} Projects`}
        action={
          canManage ? (
            <Button asChild>
              <Link href={`/teams/${slug}/projects/new`}>
                <Plus className="h-4 w-4 mr-2" />
                New Project
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl">
          {projectsWithCounts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
                <p className="text-muted-foreground mb-6 max-w-md">
                  Create projects to organize your team's work into focused areas.
                </p>
                {canManage && (
                  <Button asChild>
                    <Link href={`/teams/${slug}/projects/new`}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create First Project
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {projectsWithCounts.map((project: any) => {
                const progress = project.totalTasks > 0
                  ? Math.round((project.completedTasks / project.totalTasks) * 100)
                  : 0;

                return (
                  <Link key={project.id} href={`/teams/${slug}/projects/${project.id}`}>
                    <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-4 h-4 rounded"
                              style={{ backgroundColor: project.color }}
                            />
                            <div>
                              <CardTitle className="text-lg">{project.name}</CardTitle>
                              {project.description && (
                                <CardDescription className="line-clamp-2 mt-1">
                                  {project.description}
                                </CardDescription>
                              )}
                            </div>
                          </div>
                          <Badge variant={project.status === "active" ? "default" : "secondary"}>
                            {project.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              {project.completedTasks} / {project.totalTasks} tasks
                            </span>
                            <span className="font-medium">{progress}%</span>
                          </div>
                          <Progress value={progress} />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
