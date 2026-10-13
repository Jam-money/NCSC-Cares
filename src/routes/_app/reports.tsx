import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, CalendarDays, Clock } from "lucide-react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import type { EventRow } from "@/lib/db";
import { labelForValue, isAssignedTo } from "@/lib/attendees";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/reports")({ component: Reports });

interface ReportRow { id?: string; event_id: string; deadline: string | null; notes?: string | null; category?: string | null; assignees?: string[]; progress?: Record<string, string> }

const PROGRESS_OPTIONS = [
  { value: "ongoing", label: "Ongoing" },
  { value: "for_review_css", label: "For review (CSS)" },
  { value: "endorsed_rd", label: "Endorsed to RD" },
  { value: "approved_rd", label: "Approved by RD" },
];

const STATUS_DOT: Record<string, string> = {
  ongoing: "bg-amber-500",
  for_review_css: "bg-blue-500",
  endorsed_rd: "bg-purple-500",
  approved_rd: "bg-green-500",
};

function countdown(deadline?: string | null, allApproved?: boolean) {
  const neutral = "bg-muted text-muted-foreground border-border";
  if (allApproved) return { label: "Done", badge: "bg-green-500/10 text-green-600 border-green-500/30" };
  if (!deadline) return { label: "No deadline set", badge: neutral };
  const d = differenceInCalendarDays(parseISO(deadline), new Date());
  if (d < 0) return { label: `${-d} day${d === -1 ? "" : "s"} overdue`, badge: "bg-red-500/10 text-red-600 border-red-500/30" };
  if (d === 0) return { label: "Due today", badge: "bg-red-500/10 text-red-600 border-red-500/30" };
  return { label: `${d} day${d === 1 ? "" : "s"} left`, badge: d <= 1 ? "bg-orange-500/10 text-orange-600 border-orange-500/30" : "bg-primary/10 text-primary border-primary/20" };
}

function Reports() {
  const { user, profile, role } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  useEffect(() => {
    void (async () => {
      const { data: e } = await supabase.from("events").select("*").order("start_time");
      setEvents(e ?? []);
    })();
  }, []);

  const [reports, setReports] = useState<Record<string, ReportRow>>({});
  useEffect(() => {
    void (async () => {
      const { data } = await (supabase as any).from("event_reports").select("*");
      setReports(Object.fromEntries((data ?? []).map((r: ReportRow) => [r.event_id, r])));
    })();
  }, []);

  const saveReport = async (eventId: string, patch: { deadline?: string | null; progress?: { key: string; status: string } }) => {
    const tbl = (supabase as any).from("event_reports");
    const update: Record<string, any> = { updated_by: user?.id, updated_at: new Date().toISOString() };
    if ("deadline" in patch) update.deadline = patch.deadline;
    if (patch.progress) {
      const { data: cur } = await (supabase as any).from("event_reports").select("progress").eq("event_id", eventId).single();
      update.progress = { ...(cur?.progress ?? {}), [patch.progress.key]: patch.progress.status };
    }
    const { data, error } = await tbl.update(update).eq("event_id", eventId).select().single();
    if (error) return toast.error(error.message);
    setReports(r => ({ ...r, [eventId]: data }));
    toast.success("Report updated");
  };

  const meInfo = { email: profile?.email ?? user?.email, unit: profile?.unit, role, fullName: profile?.full_name };
  const [q, setQ] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const PREVIEW_COUNT = 5;

  const isDone = (id: string) => {
    const a = reports[id]?.assignees ?? [];
    return a.length > 0 && a.every(k => (reports[id]?.progress?.[k] ?? "ongoing") === "approved_rd");
  };
  const mine = events
    .filter(e => reports[e.id] && ((!!user && e.created_by === user.id) || isAssignedTo(reports[e.id].assignees ?? [], meInfo)))
    .sort((a, b) => {
      const rank = (id: string) => isDone(id) ? 2 : reports[id]?.deadline ? 0 : 1;
      const ra = rank(a.id), rb = rank(b.id);
      if (ra !== rb) return ra - rb;
      return (reports[a.id]?.deadline ?? "").localeCompare(reports[b.id]?.deadline ?? "");
    });
  const filtering = q.trim() !== "" || dateFilter !== "";
  const matches = mine.filter(e =>
    (!q.trim() || e.title.toLowerCase().includes(q.trim().toLowerCase())) &&
    (!dateFilter || reports[e.id]?.deadline === dateFilter));
  const reportEvents = filtering || showAll ? matches : matches.slice(0, PREVIEW_COUNT);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-semibold">Reports & history</h1><p className="text-sm text-muted-foreground">Track reports and deadlines.</p></div>
        <div className="relative w-56">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reports..."
            className="w-full border border-border rounded pl-8 pr-2 py-1.5 bg-background text-sm" />
        </div>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} title="Filter by deadline date"
          className="border border-border rounded px-2 py-1.5 bg-background text-sm" />
        {filtering && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setDateFilter(""); }}>Clear</Button>}
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="font-semibold">Reports to submit</h2>
          <p className="text-xs text-muted-foreground">Only the person who set the event can change the deadline; only the assigned people can update their own progress.</p>
        </div>

        {reportEvents.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground shadow-soft">
            {filtering ? "No reports match your search." : 'No reports for you yet. Tick "Requires a report" when creating an event, or wait to be assigned one.'}
          </Card>
        )}

        {reportEvents.map(e => {
          const r = reports[e.id];
          const assignees = r?.assignees ?? [];
          const statusOf = (k: string) => r?.progress?.[k] ?? "ongoing";
          const approved = assignees.filter(k => statusOf(k) === "approved_rd").length;
          const allDone = assignees.length > 0 && approved === assignees.length;
          const pct = assignees.length ? Math.round((approved / assignees.length) * 100) : 0;
          const cd = countdown(r?.deadline, allDone);
          const isOwner = !!user && e.created_by === user.id;
          return (
            <Card key={e.id} className="p-5 shadow-soft space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-base">{e.title}</h3>
                    {r?.category && (
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20">
                        {r.category === "pl" ? "Partnership and Linkage (P&L)" : "Information Dissemination"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" /> Event on {format(parseISO(e.start_time), "MMM d, yyyy")}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${cd.badge}`}>
                  <Clock className="h-3.5 w-3.5" /> {cd.label}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Deadline</span>
                  {isOwner
                    ? <input type="date" className="border border-border rounded-md px-2 py-1 bg-background text-sm" value={r?.deadline ?? ""} onChange={ev => void saveReport(e.id, { deadline: ev.target.value || null })} />
                    : <span className="font-medium">{r?.deadline ? format(parseISO(r.deadline), "MMM d, yyyy") : "—"}</span>}
                </div>
                {assignees.length > 0 && (
                  <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{approved}/{assignees.length} approved</span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border divide-y divide-border">
                {assignees.length === 0 && <div className="px-3 py-2.5 text-xs text-muted-foreground">No one assigned</div>}
                {assignees.map(k => {
                  const st = statusOf(k);
                  const mine = isAssignedTo([k], meInfo);
                  return (
                    <div key={k} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[st]}`} />
                        <span className="text-sm font-medium truncate">{labelForValue(k)}</span>
                        {mine && <span className="text-[10px] font-semibold uppercase text-primary">You</span>}
                      </div>
                      <select
                        className="border border-border rounded-md px-2.5 py-1.5 bg-background text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        value={st} disabled={!mine}
                        onChange={ev => void saveReport(e.id, { progress: { key: k, status: ev.target.value } })}>
                        {PROGRESS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      {!filtering && matches.length > PREVIEW_COUNT && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {reportEvents.length} of {matches.length}, nearest deadline first</span>
          <Button variant="outline" size="sm" onClick={() => setShowAll(s => !s)}>{showAll ? "Show less" : `See all (${matches.length})`}</Button>
        </div>
      )}
    </div>
  );
}
