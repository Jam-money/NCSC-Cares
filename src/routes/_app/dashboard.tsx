import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isAfter, parseISO, addDays } from "date-fns";
import { CalendarDays, Clock, Video, CalendarCheck2, ArrowRight } from "lucide-react";
import { eventTypeLabel, type EventRow } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { isAssignedTo } from "@/lib/attendees";

function getAttendees(ev: EventRow): string[] {
  const raw = (ev as any).attendees;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try { return JSON.parse(raw); } catch { return []; }
}

export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard });

function Dashboard() {
  const { profile, role, user } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const myEvents = useMemo(() => {
    if (role === "admin" || role === "director") return events;
    const me = { email: profile?.email ?? user?.email, unit: profile?.unit, role, fullName: profile?.full_name };
    return events.filter(e => isAssignedTo(getAttendees(e), me));
  }, [events, profile?.email, profile?.unit, profile?.full_name, role, user?.id, user?.email]);

  useEffect(() => {
    const load = async () => {
      const { data: e } = await supabase.from("events").select("*").gte("end_time", new Date().toISOString()).order("start_time");
      setEvents(e ?? []); setLoading(false);
    };
    void load();
    const ch = supabase.channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, load)
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const todayEvents = myEvents.filter(e => isToday(parseISO(e.start_time)));
  const upcoming    = myEvents.slice(0, 5);
  const thisWeek    = myEvents.filter(e => { const d = parseISO(e.start_time); return isAfter(d, new Date()) && d <= addDays(new Date(), 7); });
  const withLink    = myEvents.filter(e => !!(e as any).meeting_link);

  return (
    <div className="space-y-6 max-w-7xl w-full">
      <div className="relative overflow-hidden rounded-3xl gradient-brand text-white p-6 sm:p-8 shadow-elevated">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-28 right-52 h-56 w-56 rounded-full bg-white/5" />
        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden sm:block rounded-full bg-white p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.35)] ring-4 ring-white/25 transition-transform duration-500 hover:scale-105">
          <img src="/ncsc-logo.png" alt="NCSC" className="h-32 w-32 lg:h-40 lg:w-40" draggable={false} />
        </div>
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.25em] text-white/70">{format(new Date(), "EEEE, MMMM d")}</p>
          <h1 className="text-3xl sm:text-4xl font-bold mt-2">Good {greet()}, {profile?.full_name?.split(" ")[0] ?? "there"}</h1>
          <p className="text-white/80 mt-2 max-w-xl">
            {todayEvents.length === 0 ? "Your calendar is clear today." : `You have ${todayEvents.length} item${todayEvents.length === 1 ? "" : "s"} on your schedule today.`}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/calendar" className="inline-flex items-center gap-2 rounded-full bg-white text-[#1e3a8a] px-4 py-2 text-sm font-semibold shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg">
              <CalendarDays className="h-4 w-4" /> Open calendar
            </Link>
            <Link to="/meetings" className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-4 py-2 text-sm font-medium transition-all hover:bg-white/25 hover:-translate-y-0.5">
              <Video className="h-4 w-4" /> Meetings
            </Link>
          </div>
        </div>
      </div>

      <div className="stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={CalendarDays}   label="Today's schedule" value={todayEvents.length} sub={`${myEvents.length} upcoming total`}  tone="info"/>
        <Stat icon={Clock}          label="This week"         value={thisWeek.length}    sub="events scheduled"                   tone="warning"/>
        <Stat icon={Video}          label="Online meetings"   value={withLink.length}    sub="with meeting link"                  tone="success"/>
        <Stat icon={CalendarCheck2} label="Total upcoming"    value={myEvents.length}    sub="assigned to you"                  tone="destructive"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-primary" />Today's schedule</h2>
            <Link to="/calendar" className="group inline-flex items-center gap-1 text-sm text-primary hover:underline">View calendar <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></Link>
          </div>
          {loading ? <Skeleton/> : todayEvents.length === 0 ? (
            <Empty icon={CalendarDays} title="Nothing on today" sub="Your calendar is clear."/>
          ) : (
            <ul className="space-y-3">
              {todayEvents.map(ev => <ScheduleItem key={ev.id} ev={ev}/>)}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2"><span className="h-5 w-1 rounded-full bg-[var(--brand-red)]" />Upcoming meetings</h2>
            <Link to="/meetings" className="group inline-flex items-center gap-1 text-sm text-primary hover:underline">All meetings <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></Link>
          </div>
          {upcoming.length === 0 ? <Empty icon={CalendarDays} title="No upcoming meetings" sub="Events assigned to you will appear here."/> : (
            <ul className="divide-y divide-border">
              {upcoming.map(ev => (
                <li key={ev.id} className="py-3 px-2 -mx-2 rounded-xl flex items-center gap-4 transition-colors hover:bg-muted/60">
                  <div className="w-14 text-center rounded-xl bg-primary text-primary-foreground py-2 shadow-sm">
                    <div className="text-[10px] uppercase tracking-wide">{format(parseISO(ev.start_time),"MMM")}</div>
                    <div className="text-lg font-bold leading-none">{format(parseISO(ev.start_time),"d")}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{ev.title}</div>
                    <div className="text-xs text-muted-foreground">{format(parseISO(ev.start_time),"p")} · {ev.location ?? "—"}</div>
                  </div>
                  <Badge variant="outline">{eventTypeLabel(ev as any)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function greet() { const h = new Date().getHours(); return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"; }

function useCountUp(target: number) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now(), from = 0, dur = 700;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setN(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return n;
}

function Stat({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: number; sub: string; tone: "info"|"warning"|"success"|"destructive" }) {
  const toneClass = {
    info: "from-sky-500 to-blue-600", warning: "from-amber-400 to-orange-500",
    success: "from-emerald-400 to-green-600", destructive: "from-rose-500 to-red-600",
  }[tone];
  const shown = useCountUp(value);
  return (
    <Card className="group relative overflow-hidden p-5 card-lift">
      <div className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${toneClass} opacity-10 transition-all duration-500 group-hover:scale-150 group-hover:opacity-20`} />
      <div className="relative flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="text-4xl font-bold mt-1 tabular-nums">{shown}</div>
          <div className="text-xs text-muted-foreground mt-1">{sub}</div>
        </div>
        <div className={`h-12 w-12 rounded-2xl grid place-items-center text-white shadow-md bg-gradient-to-br ${toneClass} transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110`}><Icon className="h-6 w-6"/></div>
      </div>
    </Card>
  );
}
function ScheduleItem({ ev }: { ev: EventRow }) {
  return (
    <li className="group flex items-center gap-4 p-3 rounded-xl bg-muted/50 border border-transparent transition-all hover:border-primary/30 hover:bg-primary/5 hover:translate-x-1">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary"><Clock className="h-4 w-4"/></span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{ev.title}</div>
        <div className="text-xs text-muted-foreground">{format(parseISO(ev.start_time),"p")} – {format(parseISO(ev.end_time),"p")} · {ev.location ?? "—"}</div>
      </div>
      <Badge variant="outline" className="text-xs">{eventTypeLabel(ev as any)}</Badge>
    </li>
  );
}
function Empty({ icon: Icon, title, sub }: { icon: any; title: string; sub: string }) {
  return <div className="text-center py-10 text-muted-foreground"><span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="h-7 w-7"/></span><div className="text-sm font-medium text-foreground">{title}</div><div className="text-xs">{sub}</div></div>;
}
function Skeleton() { return <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-12 rounded-lg bg-muted animate-pulse"/>)}</div>; }