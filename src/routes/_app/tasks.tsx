import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Calendar as CalIcon, User2, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { format, parseISO } from "date-fns";
import { TaskDialog } from "@/components/app/TaskDialog";
import { useAuth } from "@/lib/auth";
import { logAudit, PRIORITY_META, STATUS_META, type TaskRow, type TaskStatus, type ProfileRow } from "@/lib/db";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/tasks")({ component: TasksPage });

const COLUMNS: TaskStatus[] = ["pending", "ongoing", "completed"];

function TasksPage() {
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [q, setQ] = useState(""); const [priorityFilter, setPriorityFilter] = useState<string>("all"); const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false); const [editing, setEditing] = useState<TaskRow | null>(null);

  useEffect(() => {
    const load = async () => {
      const [{ data: t }, { data: p }] = await Promise.all([
        supabase.from("tasks").select("*").order("priority"),
        supabase.from("profiles").select("*"),
      ]);
      setTasks(t ?? []);
      setProfiles(Object.fromEntries((p ?? []).map(x => [x.id, x])));
    };
    void load();
    const ch = supabase.channel("tasks-board").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, load).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => tasks.filter(t => {
    if (q && !t.title.toLowerCase().includes(q.toLowerCase()) && !(t.description ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (assigneeFilter === "me" && t.assigned_to !== user?.id) return false;
    if (assigneeFilter !== "all" && assigneeFilter !== "me" && t.assigned_to !== assigneeFilter) return false;
    return true;
  }), [tasks, q, priorityFilter, assigneeFilter, user]);

  const byCol = (s: TaskStatus) => filtered.filter(t => t.status === s);

  const onDrop = async (id: string, target: TaskStatus) => {
    const t = tasks.find(x => x.id === id); if (!t || t.status === target) return;
    const canMove = isAdmin || t.assigned_to === user?.id;
    if (!canMove) { toast.error("Only the assignee or an admin can move this task."); return; }
    const patch: any = { status: target };
    if (target === "completed") patch.progress = 100;
    if (target === "ongoing" && t.progress === 0) patch.progress = 10;
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await logAudit("task", id, "status_changed", { from: t.status, to: target });
  };

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader icon={ListChecks} title="Tasks" subtitle="Drag cards across columns to update status.">
        {isAdmin && <Button onClick={()=>{setEditing(null); setDialogOpen(true);}}><Plus className="h-4 w-4 mr-1"/>New task</Button>}
      </PageHeader>

      <Card className="p-3 flex flex-wrap gap-2 items-center shadow-soft">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <Input placeholder="Search tasks…" value={q} onChange={e=>setQ(e.target.value)} className="pl-9"/>
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem><SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            {Object.values(profiles).map(p=><SelectItem key={p.id} value={p.id}>{p.full_name ?? p.email}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        {COLUMNS.map(col => (
          <div key={col}
            onDragOver={e=>e.preventDefault()}
            onDrop={e=>{ const id = e.dataTransfer.getData("text/plain"); void onDrop(id, col); }}
            className="rounded-xl bg-muted/40 border border-border p-3 min-h-[60vh]">
            <div className="flex items-center justify-between px-1 mb-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${STATUS_META[col].dot}`}/>
                <h3 className="font-semibold text-sm">{STATUS_META[col].label}</h3>
                <Badge variant="secondary" className="text-[10px]">{byCol(col).length}</Badge>
              </div>
            </div>
            <div className="space-y-2">
              {byCol(col).map(t => {
                const assignee = t.assigned_to ? profiles[t.assigned_to] : null;
                return (
                  <button key={t.id} draggable
                    onDragStart={e=>e.dataTransfer.setData("text/plain", t.id)}
                    onClick={()=>{ setEditing(t); setDialogOpen(true); }}
                    className="w-full text-left bg-card border border-border rounded-lg p-3 hover:shadow-soft hover:border-primary/40 transition-all cursor-grab active:cursor-grabbing">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium text-sm leading-snug">{t.title}</h4>
                      <Badge className={PRIORITY_META[t.priority].color + " border-0 text-[10px] shrink-0"}>{PRIORITY_META[t.priority].label}</Badge>
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1"><span>Progress</span><span>{t.progress}%</span></div>
                      <Progress value={t.progress} className="h-1.5"/>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><User2 className="h-3 w-3"/>{assignee?.full_name?.split(" ")[0] ?? "Unassigned"}</span>
                      {t.due_date && <span className="inline-flex items-center gap-1"><CalIcon className="h-3 w-3"/>{format(parseISO(t.due_date),"MMM d")}</span>}
                    </div>
                  </button>
                );
              })}
              {byCol(col).length === 0 && <div className="text-center text-xs text-muted-foreground py-8">Drop tasks here</div>}
            </div>
          </div>
        ))}
      </div>

      <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} task={editing}/>
    </div>
  );
}
