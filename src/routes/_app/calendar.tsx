import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Plus, MessageSquare, Video, CalendarDays, X } from "lucide-react";
import {
  addDays, addMonths, addWeeks, eachDayOfInterval,
  endOfMonth, endOfWeek, format, isSameDay, isSameMonth,
  parseISO, startOfDay, startOfMonth, startOfWeek,
  subMonths, subWeeks,
} from "date-fns";
import { EventDialog } from "@/components/app/EventDialog";
import { useAuth } from "@/lib/auth";
import type { EventRow } from "@/lib/db";
import {
  ATTENDEES, AttendeeValue, RSVPMap,
  attendeePillStyle, activeAttendees,
  colorForValue, labelForValue, isAssignedTo, loadUnitOverrides,
} from "@/lib/attendees";

export const Route = createFileRoute("/_app/calendar")({ component: CalendarPage });

type View = "month" | "week" | "day";

function dayStart(d: Date | string) {
  return startOfDay(typeof d === "string" ? parseISO(d) : d);
}
function isMultiDay(ev: EventRow) {
  return dayStart(ev.start_time).getTime() !== dayStart(ev.end_time).getTime();
}
function eventTouchesDay(ev: EventRow, d: Date) {
  return dayStart(d) >= dayStart(ev.start_time) && dayStart(d) <= dayStart(ev.end_time);
}
function getAttendees(ev: EventRow): string[] {
  const raw = (ev as any).attendees;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try { return JSON.parse(raw); } catch { return []; }
}
function getRsvpMap(ev: EventRow): RSVPMap {
  const raw = (ev as any).rsvp_responses;
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as RSVPMap;
  try { return JSON.parse(raw); } catch { return {}; }
}
function getRsvpNotes(ev: EventRow): Partial<Record<string, string>> {
  const raw = (ev as any).rsvp_notes;
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

// Strict unit filtering: a CRASD user sees only events tagged "CRASD" in
// attendees, a SOCD user sees only events tagged "SOCD". Admins and directors see everything.
// The event's creator can always see their own event, regardless of unit tags.
function eventVisibleToUnit(ev: EventRow, isAdmin: boolean, isDirector: boolean, myUnit: string | null, myUserId: string | null, me: { email?: string | null; fullName?: string | null }) {
  if (isAdmin || isDirector) return true;
  if (myUserId && (ev as any).created_by === myUserId) return true;
  return isAssignedTo(getAttendees(ev), { email: me.email, fullName: me.fullName, unit: myUnit });
}

interface PlacedEvent {
  ev: EventRow;
  startCol: number;
  endCol: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
}

function layoutWeek(week: Date[], events: EventRow[]): PlacedEvent[] {
  const weekStart = dayStart(week[0]);
  const weekEnd   = dayStart(week[6]);

  const visible = events.filter(ev => {
    const s = dayStart(ev.start_time), e = dayStart(ev.end_time);
    return s <= weekEnd && e >= weekStart;
  });

  const sorted = [...visible].sort((a, b) => {
    const aM = isMultiDay(a) ? 1 : 0, bM = isMultiDay(b) ? 1 : 0;
    if (bM !== aM) return bM - aM;
    return dayStart(a.start_time).getTime() - dayStart(b.start_time).getTime();
  });

  const placed: PlacedEvent[] = [];
  const laneEndAt: number[] = [];

  sorted.forEach(ev => {
    const evS = dayStart(ev.start_time), evE = dayStart(ev.end_time);
    const clampedS = evS < weekStart ? weekStart : evS;
    const clampedE = evE > weekEnd   ? weekEnd   : evE;
    const startCol = week.findIndex(d => isSameDay(d, clampedS));
    const endCol   = week.findIndex(d => isSameDay(d, clampedE));
    let lane = 0;
    while (laneEndAt[lane] !== undefined && laneEndAt[lane] >= startCol) lane++;
    laneEndAt[lane] = endCol;
    placed.push({ ev, startCol, endCol, lane, isStart: isSameDay(evS, clampedS), isEnd: isSameDay(evE, clampedE) });
  });

  return placed;
}

const LANE_H      = 24;
const DATE_H      = 30;
const PADDING     = 8;
const MAX_VISIBLE = 3;

function AttendeeLegend({ active, onToggle, onClear }: { active: string[]; onToggle: (v: string) => void; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border bg-card/60 px-3 py-2">
      <span className="text-xs text-muted-foreground font-medium">Filter by attendee:</span>
      {ATTENDEES.map(a => {
        const on = active.includes(a.value);
        const dim = active.length > 0 && !on;
        return (
          <button key={a.value} type="button" onClick={() => onToggle(a.value)}
            className={["inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full text-white transition-all duration-200 hover:scale-105 hover:shadow-md active:scale-95",
              on ? "ring-2 ring-offset-2 ring-offset-background ring-white/70 shadow-md" : "", dim ? "opacity-35" : ""].join(" ")}
            style={{ background: a.hex }}>
            <span className="h-1.5 w-1.5 rounded-full bg-white/70 inline-block" />{a.label}
          </button>
        );
      })}
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full text-white bg-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-white/60 inline-block" />All declined
      </span>
      {active.length > 0 && (
        <button type="button" onClick={onClear} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  );
}

export function CalendarPage() {
  const { role, profile, user } = useAuth();
  const canEdit = role === "admin" || role === "director" || role === "staff";
  const isAdmin = role === "admin";
  const isDirector = role === "director";
  const myUnit  = profile?.unit ?? null;
  const myUserId = user?.id ?? null;

  const [view, setView]               = useState<View>("month");
  const [cursor, setCursor]           = useState(new Date());
  const [allEvents, setEvents]        = useState<EventRow[]>([]);
  const [filter, setFilter]           = useState<string[]>([]);
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editing, setEditing]         = useState<EventRow | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | undefined>();

  const [, bumpColors] = useState(0);
  useEffect(() => { void loadUnitOverrides().then(() => bumpColors(n => n + 1)); }, []);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void supabase.from("profiles").select("id,full_name").then(({ data }) =>
      setNames(Object.fromEntries((data ?? []).map(p => [p.id, p.full_name ?? ""]))));
  }, []);
  const creatorOf = (ev: EventRow) => names[ev.created_by] || "";

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("events").select("*").order("start_time");
      setEvents((data ?? []).filter(ev => eventVisibleToUnit(ev, isAdmin, isDirector, myUnit, myUserId, { email: profile?.email ?? user?.email, fullName: profile?.full_name })));
    };
    void load();

    const ch = supabase.channel("cal")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, load)
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [isAdmin, isDirector, myUnit, myUserId, profile?.email, profile?.full_name, user?.email]);

  const events = useMemo(
    () => filter.length === 0 ? allEvents : allEvents.filter(ev => getAttendees(ev).some(a => filter.includes(a))),
    [allEvents, filter],
  );
  const toggleFilter = (v: string) => setFilter(f => f.includes(v) ? f.filter(x => x !== v) : [...f, v]);

  const days = useMemo(() => {
    if (view === "month") return eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)) });
    if (view === "week")  return eachDayOfInterval({ start: startOfWeek(cursor), end: endOfWeek(cursor) });
    return [cursor];
  }, [cursor, view]);

  const weekRows = useMemo(() => {
    if (view !== "month") return [];
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows.map(week => ({ week, placed: layoutWeek(week, events) }));
  }, [days, events, view]);

  const evByDay = (d: Date) => events.filter(ev => eventTouchesDay(ev, d));

  const nav = (dir: -1 | 1) => {
    if (view === "month")     setCursor(dir === 1 ? addMonths(cursor, 1) : subMonths(cursor, 1));
    else if (view === "week") setCursor(dir === 1 ? addWeeks(cursor, 1)  : subWeeks(cursor, 1));
    else                      setCursor(addDays(cursor, dir));
  };

  const canEditEv = (ev: EventRow) => canEdit && ev.created_by === myUserId;
  const openNew  = (d?: Date)     => { setEditing(null); setDefaultDate(d); setDialogOpen(true); };
  const openEdit = (ev: EventRow) => { setEditing(ev);   setDialogOpen(true); };

  // Open the event dialog when arriving from a notification (?open=<eventId>)
  const notifNav = useNavigate();
  const searchOpen = (useSearch({ strict: false }) as { open?: string }).open;
  const [openedFromNotif, setOpenedFromNotif] = useState<string | null>(null);
  useEffect(() => {
    const id = searchOpen;
    if (!id || id === openedFromNotif) return;
    const open = (ev: EventRow) => {
      setOpenedFromNotif(id);
      openEdit(ev);
      void notifNav({ to: "/calendar", replace: true });
    };
    const found = allEvents.find(e => e.id === id);
    if (found) open(found);
    else void supabase.from("events").select("*").eq("id", id).maybeSingle()
      .then(({ data }) => { if (data) open(data as EventRow); });
  }, [searchOpen, openedFromNotif, allEvents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (dialogOpen || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) || t?.isContentEditable) return;
      if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "ArrowRight") nav(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const monthCount = useMemo(
    () => events.filter(ev => isSameMonth(parseISO(ev.start_time), cursor)).length,
    [events, cursor],
  );

  const onDrop = async (id: string, target: Date) => {
    const ev = allEvents.find(e => e.id === id); if (!ev || !canEditEv(ev)) return;
    const s = parseISO(ev.start_time), e = parseISO(ev.end_time);
    const duration = e.getTime() - s.getTime();
    const ns = new Date(target); ns.setHours(s.getHours(), s.getMinutes());
    const ne = new Date(ns.getTime() + duration);
    await supabase.from("events").update({ start_time: ns.toISOString(), end_time: ne.toISOString() }).eq("id", id);
  };

  return (
    <div className="space-y-4 max-w-7xl w-full">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-2xl gradient-primary text-white shadow-md"><CalendarDays className="h-5 w-5" /></span>
            Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            <span key={cursor.toISOString().slice(0, 7) + view} className="font-medium text-foreground animate-fade-in-up inline-block">{format(cursor, view === "day" ? "EEEE, MMM d, yyyy" : "MMMM yyyy")}</span>
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{monthCount} event{monthCount === 1 ? "" : "s"} this month</span>
            {!isAdmin && myUnit && <span className="ml-2 text-xs font-medium uppercase tracking-wide text-primary">· {myUnit}</span>}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <Tabs value={view} onValueChange={v => setView(v as View)} className="w-full sm:w-auto">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="day" className="flex-1">Day</TabsTrigger>
              <TabsTrigger value="week" className="flex-1">Week</TabsTrigger>
              <TabsTrigger value="month" className="flex-1">Month</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="transition-transform hover:-translate-x-0.5" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4"/></Button>
            <Button variant="outline" size="sm"   onClick={() => setCursor(new Date())}>Today</Button>
            <Button variant="outline" size="icon" className="transition-transform hover:translate-x-0.5" onClick={() => nav(1)}><ChevronRight className="h-4 w-4"/></Button>
          </div>
          {canEdit && <Button onClick={() => openNew()} className="w-full sm:w-auto shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"><Plus className="h-4 w-4 mr-1"/>New event</Button>}
        </div>
      </div>

      <AttendeeLegend active={filter} onToggle={toggleFilter} onClear={() => setFilter([])} />

      <Card className="shadow-soft overflow-hidden rounded-2xl border-border/70">

        {view === "month" && (
          <>
            <div className="grid grid-cols-7 bg-muted/50 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                <div key={d} className={["px-2 py-2.5 text-center", i === 0 || i === 6 ? "text-primary/70" : ""].join(" ")}>{d}</div>
              ))}
            </div>

            {weekRows.map(({ week, placed }, rowIdx) => {
              const maxLane      = placed.reduce((m, p) => Math.max(m, p.lane), -1);
              const visibleLanes = Math.min(maxLane + 1, MAX_VISIBLE);
              const hasOverflow  = maxLane + 1 > MAX_VISIBLE;
              const rowH = Math.max(110, DATE_H + visibleLanes * LANE_H + (hasOverflow ? LANE_H : 0) + PADDING);

              return (
                <div key={`${cursor.getMonth()}-${rowIdx}`} className="relative grid grid-cols-7 border-t border-border animate-fade-in-up" style={{ height: rowH, animationDelay: `${rowIdx * 40}ms`, animationFillMode: "backwards" }}>

                  {week.map(d => {
                    const inMonth = isSameMonth(d, cursor);
                    const today   = isSameDay(d, startOfDay(new Date()));
                    return (
                      <div key={d.toISOString()}
                        onDragOver={canEdit ? e => e.preventDefault() : undefined}
                        onDrop={canEdit ? e => { const id = e.dataTransfer.getData("text/plain"); void onDrop(id, d); } : undefined}
                        onClick={() => canEdit && openNew(d)}
                        className={[
                          "group relative h-full border-r border-border last:border-r-0 pt-1.5 px-1.5 transition-colors duration-200",
                          canEdit ? "cursor-pointer hover:bg-primary/5" : "",
                          today ? "bg-primary/10" : inMonth ? (d.getDay() === 0 || d.getDay() === 6 ? "bg-muted/20" : "bg-background") : "bg-muted/30 opacity-60",
                        ].join(" ")}
                      >
                        <div className={[
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-transform group-hover:scale-110",
                          today ? "bg-primary text-primary-foreground shadow-md ring-4 ring-primary/20" : inMonth ? "text-foreground" : "text-muted-foreground",
                        ].join(" ")}>
                          {format(d, "d")}
                        </div>
                        {canEdit && (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-primary opacity-0 scale-75 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100">
                            <Plus className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {placed.filter(p => p.lane < MAX_VISIBLE).map((p, i) => {
                    const colPct    = 100 / 7;
                    const GAP       = 2;
                    const span      = p.endCol - p.startCol + 1;
                    const attendees = getAttendees(p.ev);
                    const rsvpMap   = getRsvpMap(p.ev);
                    const bgStyle   = attendeePillStyle(attendees, rsvpMap);
                    const rdDeclined = attendees.includes("RD") && rsvpMap["RD"] === "no";
                    const allGone   = activeAttendees(attendees, rsvpMap).length === 0 && attendees.length > 0;
                    const rdNote    = getRsvpNotes(p.ev)["RD"];
                    const hasLink   = !!(p.ev as any).meeting_link;

                    const rl = p.isStart ? "6px" : "0px";
                    const rr = p.isEnd   ? "6px" : "0px";

                    return (
                      <div key={`${p.ev.id}-${i}`}
                        draggable={canEditEv(p.ev)}
                        onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", p.ev.id); }}
                        onClick={e => { e.stopPropagation(); openEdit(p.ev); }}
                        style={{
                          position: "absolute",
                          top:    DATE_H + p.lane * LANE_H,
                          left:   `calc(${p.startCol * colPct}% + ${GAP}px)`,
                          width:  `calc(${span * colPct}% - ${GAP * 2}px)`,
                          height: LANE_H - 3,
                          borderRadius: `${rl} ${rr} ${rr} ${rl}`,
                          borderLeftWidth:  p.isStart ? undefined : "0",
                          borderRightWidth: p.isEnd   ? undefined : "0",
                          zIndex: 5,
                          opacity: allGone ? 0.45 : 1,
                          ...bgStyle,
                        }}
                        className={[
                          "flex items-center gap-1 px-1.5 overflow-hidden",
                          "text-[11px] font-medium border border-black/10",
                          "shadow-sm hover:shadow-md hover:brightness-110 hover:-translate-y-px transition-all duration-150 text-white",
                          canEdit ? "cursor-pointer" : "cursor-default",
                        ].join(" ")}
                      >
                        {p.isStart ? (
                          <span className="shrink-0 opacity-80 text-[10px]">
                            {format(parseISO(p.ev.start_time), "HH:mm")}
                          </span>
                        ) : (
                          <span className="shrink-0 opacity-60 text-[10px]">↠</span>
                        )}
                        <span className="truncate flex-1" title={creatorOf(p.ev) ? `By ${creatorOf(p.ev)}` : undefined}>{p.ev.title}</span>
                        {rdDeclined && p.isEnd && (
                          <span title="RD declined"
                            className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[7px] font-bold bg-black/25 line-through">
                            R
                          </span>
                        )}
                        {hasLink && p.isEnd && (
                          <span title="Online meeting — click to join"
                            className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-blue-500/80">
                            <Video className="w-2 h-2 text-white" />
                          </span>
                        )}
                        {rdNote && p.isEnd && (
                          <span title={rdNote}
                            className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-purple-500/80">
                            <MessageSquare className="w-2 h-2 text-white" />
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {week.map((d, colIdx) => {
                    const overflow = placed.filter(p => p.lane >= MAX_VISIBLE && colIdx >= p.startCol && colIdx <= p.endCol);
                    if (overflow.length === 0) return null;
                    const colPct = 100 / 7;
                    return (
                      <button key={`more-${d.toISOString()}`}
                        onClick={e => { e.stopPropagation(); setCursor(d); setView("day"); }}
                        style={{ position: "absolute", top: DATE_H + MAX_VISIBLE * LANE_H + 1, left: `calc(${colIdx * colPct}% + 4px)`, width: `calc(${colPct}% - 8px)`, height: LANE_H - 4, zIndex: 6 }}
                        className="flex items-center text-[10px] text-muted-foreground font-medium hover:text-primary transition-colors">
                        +{overflow.length} more
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}

        {view !== "month" && (
          <div className="divide-y divide-border">
            {days.map(d => {
              const evs = evByDay(d);
              return (
                <div key={d.toISOString()} className="grid grid-cols-[80px_1fr] sm:grid-cols-[120px_1fr]">
                  <div className="p-3 sm:p-4 bg-muted/40 border-r border-border">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{format(d, "EEE")}</div>
                    <div className="text-xl sm:text-2xl font-bold">{format(d, "d")}</div>
                    <div className="text-xs text-muted-foreground">{format(d, "MMM")}</div>
                  </div>
                  <div className="p-2 sm:p-3 space-y-2 min-h-[100px] sm:min-h-[120px]"
                    onDragOver={canEdit ? e => e.preventDefault() : undefined}
                    onDrop={canEdit ? e => { const id = e.dataTransfer.getData("text/plain"); void onDrop(id, d); } : undefined}>
                    {evs.length === 0 && <div className="text-xs text-muted-foreground h-full grid place-items-center">No events</div>}
                    {evs.map(ev => {
                      const multi      = isMultiDay(ev);
                      const attendees  = getAttendees(ev);
                      const rsvpMap    = getRsvpMap(ev);
                      const bgStyle    = attendeePillStyle(attendees, rsvpMap);
                      const active     = activeAttendees(attendees, rsvpMap);
                      const rdDeclined = attendees.includes("RD") && rsvpMap["RD"] === "no";
                      const allGone    = active.length === 0 && attendees.length > 0;
                      const rdNote     = getRsvpNotes(ev)["RD"];
                      const hasLink    = !!(ev as any).meeting_link;

                      return (
                        <button key={ev.id}
                          draggable={canEditEv(ev)}
                          onDragStart={e => e.dataTransfer.setData("text/plain", ev.id)}
                          onClick={() => openEdit(ev)}
                          className="w-full text-left rounded-lg overflow-hidden border border-black/10 hover:brightness-95 transition-all"
                          style={{ opacity: allGone ? 0.5 : 1 }}>
                          <div className="h-1.5 w-full" style={bgStyle} />
                          <div className="px-3 py-2 bg-background">
                            <div className="font-medium text-sm flex items-center gap-1.5 text-foreground">
                              {ev.title}
                              {hasLink && (
                                <span title="Online meeting"
                                  className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 border border-blue-300">
                                  <Video className="w-2.5 h-2.5 text-blue-600" />
                                </span>
                              )}
                              {rdNote && (
                                <span title={rdNote}
                                  className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-purple-100 border border-purple-300">
                                  <MessageSquare className="w-2.5 h-2.5 text-purple-600" />
                                </span>
                              )}
                              {multi && (
                                <span className="text-[10px] bg-muted border border-border rounded px-1.5 py-0.5 font-normal text-muted-foreground">multi-day</span>
                              )}
                              {allGone && (
                                <span className="text-[10px] bg-red-50 border border-red-200 rounded px-1.5 py-0.5 font-normal text-red-600">All declined</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {format(parseISO(ev.start_time), "p")} – {format(parseISO(ev.end_time), "p")}
                              {ev.location ? ` · ${ev.location}` : ""}
                            </div>
                            {creatorOf(ev) && (
                              <div className="text-[11px] text-muted-foreground mt-0.5">Created by <span className="font-medium text-foreground">{creatorOf(ev)}</span></div>
                            )}
                            {multi && (
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {format(parseISO(ev.start_time), "MMM d")} → {format(parseISO(ev.end_time), "MMM d")}
                              </div>
                            )}
                            {attendees.length > 0 && (
                              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                {attendees.map(key => {
                                  const a      = colorForValue(key);
                                  const r      = key === "RD" ? rsvpMap["RD"] : undefined;
                                  const isNo   = r === "no";
                                  return (
                                    <span key={key}
                                      style={isNo
                                        ? { background: "#f1f5f9", color: "#94a3b8", borderColor: "#e2e8f0", textDecoration: "line-through" }
                                        : { background: a.bg, color: a.text, borderColor: a.border }}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                                      title={key === "RD" && r ? `RD: ${r}` : labelForValue(key)}>
                                      <span style={{ background: isNo ? "#94a3b8" : a.dot }} className="w-1.5 h-1.5 rounded-full" />
                                      {labelForValue(key)}
                                      {r === "yes"   && <span className="text-green-500 ml-0.5">✓</span>}
                                      {r === "no"    && <span className="text-red-400   ml-0.5">✗</span>}
                                      {r === "maybe" && <span className="text-yellow-500 ml-0.5">?</span>}
                                    </span>
                                  );
                                })}
                                {rdDeclined && (
                                  <span className="text-[10px] text-red-500 font-medium">· RD declined</span>
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <EventDialog open={dialogOpen} onOpenChange={setDialogOpen} event={editing} defaultDate={defaultDate} canEdit={editing ? canEditEv(editing) : canEdit} />
    </div>
  );
}