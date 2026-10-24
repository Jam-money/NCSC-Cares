import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, MapPin, Clock, Search, Users2 } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { format, parseISO, isPast, endOfWeek } from "date-fns";
import { EventDialog } from "@/components/app/EventDialog";
import { useAuth } from "@/lib/auth";
import type { EventRow } from "@/lib/db";
import { eventTypeLabel } from "@/lib/db";

export const Route = createFileRoute("/_app/meetings")({ component: Meetings });

function Meetings() {
  const { role, user } = useAuth();
  const canEdit = role === "admin";
  const [events, setEvents] = useState<EventRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false); const [editing, setEditing] = useState<EventRow | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("events").select("*").order("start_time", { ascending: false });
      setEvents(data ?? []);
    };
    void load();
    const ch = supabase.channel("meet").on("postgres_changes", { event: "*", schema: "public", table: "events" }, load).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const filtered = events.filter(e => !q || e.title.toLowerCase().includes(q.toLowerCase()) || (e.location ?? "").toLowerCase().includes(q.toLowerCase()));
  const upcoming = filtered.filter(e => !isPast(parseISO(e.end_time)))
    .sort((a, b) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());
  const past = filtered.filter(e => isPast(parseISO(e.end_time)));
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
  const thisWeek = upcoming.filter(e => parseISO(e.start_time).getTime() <= weekEnd);
  const openEvent = (ev: EventRow) => { setEditing(ev); setOpen(true); };

  return (
    <div className="space-y-6 max-w-5xl w-full">
      <PageHeader icon={Users2} title="Meetings & schedule" subtitle="Your agenda and upcoming meetings">
        {canEdit && <Button onClick={()=>{setEditing(null); setOpen(true);}} className="w-full sm:w-auto shadow-md hover:-translate-y-0.5 transition-all"><Plus className="h-4 w-4 mr-1"/>Schedule</Button>}
      </PageHeader>

      <div className="relative max-w-md w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
        <Input placeholder="Search meetings…" value={q} onChange={e=>setQ(e.target.value)} className="pl-9 rounded-full bg-card"/>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Today & this week · {thisWeek.length}</h2>
        <div className="stagger grid grid-cols-1 gap-3">
          {thisWeek.map(ev => <MeetingCard key={ev.id} ev={ev} onClick={()=>openEvent(ev)}/>)}
          {thisWeek.length === 0 && <p className="text-sm text-muted-foreground">No meetings today or this week.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">History · {past.length}</h2>
        <div className="grid grid-cols-1 gap-3">
          {(showHistory ? past : past.slice(0,3)).map(ev => <MeetingCard key={ev.id} ev={ev} onClick={()=>openEvent(ev)} muted/>)}
          {past.length === 0 && <p className="text-sm text-muted-foreground">No past meetings.</p>}
        </div>
        {past.length > 3 && (
          <Button variant="outline" size="sm" className="mt-3" onClick={()=>setShowHistory(v=>!v)}>
            {showHistory ? "Show less" : `View more (${past.length - 3})`}
          </Button>
        )}
      </section>

      <EventDialog open={open} onOpenChange={setOpen} event={editing} canEdit={editing ? editing.created_by === user?.id : canEdit}/>
    </div>
  );
}

function MeetingCard({ ev, onClick, muted }: { ev: EventRow; onClick: () => void; muted?: boolean }) {
  return (
    <Card onClick={onClick} className={`group relative overflow-hidden p-4 pl-5 cursor-pointer card-lift ${muted ? "opacity-70" : ""}`}>
      <span className={`absolute left-0 inset-y-0 w-1 ${muted ? "bg-muted-foreground/40" : "bg-gradient-to-b from-primary to-[var(--brand-red)]"}`} />
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold group-hover:text-primary transition-colors">{ev.title}</h3>
        <Badge variant="outline" className="shrink-0">{eventTypeLabel(ev as any)}</Badge>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5"/>{format(parseISO(ev.start_time),"EEE, MMM d · p")} – {format(parseISO(ev.end_time),"p")}</div>
        {ev.location && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5"/>{ev.location}</div>}
      </div>
      {ev.description && <p className="text-sm mt-2 line-clamp-2">{ev.description}</p>}
    </Card>
  );
}
