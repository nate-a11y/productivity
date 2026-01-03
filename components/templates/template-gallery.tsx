"use client";

import { useState } from "react";
import { Folder, FileText, Plus, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createProjectFromTemplate, createTaskFromTemplate } from "@/app/(dashboard)/actions";
import { toast } from "sonner";
import type { TaskTemplate, ProjectTemplate } from "@/lib/supabase/types";

interface TemplateGalleryProps {
  taskTemplates: TaskTemplate[];
  projectTemplates: ProjectTemplate[];
  defaultListId?: string;
  onSelectTaskTemplate?: (templateId: string) => void;
  onSelectProjectTemplate?: (templateId: string) => void;
}

export function TemplateGallery({
  taskTemplates,
  projectTemplates,
  defaultListId,
  onSelectTaskTemplate,
  onSelectProjectTemplate,
}: TemplateGalleryProps) {
  const [search, setSearch] = useState("");

  const filteredTaskTemplates = taskTemplates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.task_data.title.toLowerCase().includes(search.toLowerCase())
  );

  const filteredProjectTemplates = projectTemplates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase())
  );

  async function handleUseTaskTemplate(templateId: string) {
    if (!defaultListId) {
      toast.error("Please select a list first");
      return;
    }
    const result = await createTaskFromTemplate(templateId, defaultListId);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Task created from template!");
      onSelectTaskTemplate?.(templateId);
    }
  }

  async function handleUseProjectTemplate(templateId: string) {
    const result = await createProjectFromTemplate(templateId);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Project created from template!");
      onSelectProjectTemplate?.(templateId);
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Tabs defaultValue="projects">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="projects">
            <Folder className="h-4 w-4 mr-2" />
            Projects ({filteredProjectTemplates.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <FileText className="h-4 w-4 mr-2" />
            Tasks ({filteredTaskTemplates.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {filteredProjectTemplates.map((template) => (
              <Card key={template.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${template.color}20` }}
                      >
                        <Folder className="h-4 w-4" style={{ color: template.color }} />
                      </div>
                      <CardTitle className="text-base">{template.name}</CardTitle>
                    </div>
                    {template.is_public && (
                      <Badge variant="secondary" className="text-xs">
                        Public
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {template.description && (
                    <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {template.tasks.length} tasks
                    </span>
                    <Button size="sm" onClick={() => handleUseProjectTemplate(template.id)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Use
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {filteredProjectTemplates.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No project templates found
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {filteredTaskTemplates.map((template) => (
              <Card key={template.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    {template.is_public && (
                      <Badge variant="secondary" className="text-xs">
                        Public
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-2">{template.task_data.title}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {template.subtasks?.length || 0} subtasks
                    </span>
                    <Button size="sm" onClick={() => handleUseTaskTemplate(template.id)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Use
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {filteredTaskTemplates.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No task templates found
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
