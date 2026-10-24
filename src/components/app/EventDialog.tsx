import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import type { EventRow, EventType } from "@/lib/db";
import { logAudit, eventTypeLabel, EVENT_TYPE_BADGE } from "@/lib/db";
import { format, parseISO } from "date-fns";
import {
  ChevronDown, ChevronUp, X,
  CheckCircle2, XCircle, HelpCircle,
  CalendarClock, MessageSquarePlus, Video, Copy,
  MapPin, CalendarDays,
} from "lucide-react";
import {
  ATTENDEES, AttendeeValue, RSVPStatus, RSVPMap, MANAGEMENT_KEYS,
  attendeePillStyle, colorForValue, labelForValue,
  staffByDept, staffTag, isAssignedTo, loadUnitOverrides,
} from "@/lib/attendees";

async function notifyDirectors(title: string, body: string, link = "/calendar") {
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "director");
  if (!roles?.length) return;
  await supabase.from("notifications").insert(
    roles.map(r => ({ user_id: r.user_id, title, body, link, read: false }))
  );
}

async function notifyReportAssignees(assignees: string[], selfId: string, title: string, body: string, link = "/reports", what = "report assignees") {
  if (!assignees.length) return;
  const [{ data: profs }, { data: dirs }] = await Promise.all([
    (supabase as any).from("profiles").select("id,email,full_name,unit") as Promise<{ data: { id: string; email: string | null; full_name: string | null; unit: string | null }[] | null }>,
    supabase.from("user_roles").select("user_id").eq("role", "director"),
  ]);
  const directors = new Set((dirs ?? []).map(d => d.user_id));
  const targets = (profs ?? []).filter(p => p.id !== selfId && isAssignedTo(assignees, {
    email: p.email, unit: p.unit, fullName: p.full_name, role: directors.has(p.id) ? "director" : null,
  }));
  if (!targets.length) return toast.warning(`No matching user accounts found to notify for the selected ${what}.`);
  const { error } = await (supabase.rpc as any)("notify_users", {
    p_user_ids: targets.map(p => p.id), p_title: title, p_body: body, p_link: link,
  });
  if (error) toast.warning("Could not send notifications: " + error.message);
}

async function notifyOrganizer(creatorId: string | null | undefined, selfId: string, title: string, body: string, link = "/calendar") {
  if (!creatorId || creatorId === selfId) return;
  await (supabase.rpc as any)("notify_users", { p_user_ids: [creatorId], p_title: title, p_body: body, p_link: link });
}

async function notifyAdmins(title: string, body: string, link = "/calendar") {
  await (supabase.rpc as any)("notify_role", { p_role: "admin", p_title: title, p_body: body, p_link: link });
}

// ── Attendee multi-select (dept pills + expandable staff dropdown) ──────────
function AttendeeSelect({
  value, onChange, disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [openDept, setOpenDept] = useState<"SOCD" | "CRASD" | "ORD" | null>(null);
  const [, bumpStaff] = useState(0);

  // Pull unit members from profiles so Manage Units assignments show up in the picker
  useEffect(() => {
    void loadUnitOverrides().then(() => bumpStaff(n => n + 1));
  }, [openDept]);

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);

  const staffChips = value.filter(v => v.startsWith("staff:"));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ATTENDEES.map(a => {
          const selected = value.includes(a.value);
          const isGroup  = a.value === "SOCD" || a.value === "CRASD" || a.value === "ORD";
          const deptCount = isGroup
            ? value.filter(v => v.startsWith("staff:") && colorForValue(v).value === a.value).length
            : 0;

          return (
            <button
              key={a.value}
              type="button"
              disabled={disabled}
              onClick={() => isGroup
                ? setOpenDept(openDept === a.value ? null : (a.value as "SOCD" | "CRASD" | "ORD"))
                : toggle(a.value)}
              style={selected ? { background: a.bg, color: a.text, borderColor: a.border } : undefined}
              className={[
                "inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs font-semibold border transition-all select-none",
                selected
                  ? "ring-2 ring-offset-1 ring-current/30"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted/70",
                disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              <span
                style={{ background: selected ? a.dot : undefined }}
                className={`w-2 h-2 rounded-full shrink-0 ${selected ? "" : "bg-muted-foreground/40"}`}
              />
              {a.label}
              {selected && <span className="ml-0.5 opacity-70">✓</span>}
              {!selected && deptCount > 0 && (
                <span className="ml-1 text-[10px] bg-black/10 rounded-full px-1.5">{deptCount}</span>
              )}
              {isGroup && (
                <span
                  onClick={e => {
                    e.stopPropagation();
                    setOpenDept(openDept === a.value ? null : (a.value as "SOCD" | "CRASD" | "ORD"));
                  }}
                  className="ml-0.5 -mr-1 p-0.5 rounded-full hover:bg-black/10"
                >
                  {openDept === a.value ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Staff dropdown for SOCD / CRASD */}
      {openDept && (
        <div className="rounded-lg border border-border p-2.5 bg-muted/20 space-y-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            {openDept} staff
          </p>
          <div className="flex flex-wrap gap-1.5">
            {staffByDept(openDept).map(member => {
              const sel  = value.includes(member.id);
              const dept = colorForValue(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(member.id)}
                  style={sel ? { background: dept.bg, color: dept.text, borderColor: dept.border } : undefined}
                  className={[
                    "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all select-none",
                    sel ? "" : "bg-background text-muted-foreground border-border hover:bg-muted/60",
                    disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                  title={`${member.fullName} — ${member.position}`}
                >
                  {staffTag(member)}{sel && " ✓"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected staff chips (visible even when dropdown is closed) */}
      {staffChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {staffChips.map(id => {
            const dept = colorForValue(id);
            return (
              <span key={id}
                style={{ background: dept.bg, color: dept.text, borderColor: dept.border }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border">
                {labelForValue(id)}
                {!disabled && (
                  <button type="button" onClick={() => toggle(id)} className="ml-0.5 opacity-60 hover:opacity-100">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── RSVP pill button ─────────────────────────────────────────────────────────
function RSVPBtn({
  status, current, onClick, icon, label, activeClass, disabled,
}: {
  status: RSVPStatus; current: RSVPStatus; onClick: () => void;
  icon: React.ReactNode; label: string; activeClass: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        current === status
          ? `${activeClass} shadow-sm`
          : "border-border text-muted-foreground bg-background hover:bg-muted/50 hover:text-foreground",
      ].join(" ")}>
      {icon}{label}
    </button>
  );
}

// ── Admin RSVP summary row ────────────────────────────────────────────────────
function RSVPSummaryRow({ label, colors, status, note }: {
  label: string;
  colors: { bg: string; text: string; border: string; dot: string; value: string };
  status: RSVPStatus;
  note?: string;
}) {
  const cfg = {
    yes:   { icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "text-green-700 bg-green-50 border-green-200",    label: "Going" },
    no:    { icon: <XCircle      className="w-3.5 h-3.5" />, cls: "text-red-700   bg-red-50   border-red-200",      label: "Not going" },
    maybe: { icon: <HelpCircle   className="w-3.5 h-3.5" />, cls: "text-yellow-700 bg-yellow-50 border-yellow-200", label: "Maybe" },
  };
  const s = status ? cfg[status] : null;

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors">
      <span style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border shrink-0 min-w-[56px] justify-center">
        <span style={{ background: colors.dot }} className="w-2 h-2 rounded-full" />
        {label}
      </span>

      {/* Only management (RD/JBT/SBB) have a real RSVP status; everyone else always attends */}
      {MANAGEMENT_KEYS.includes(colors.value) ? (
        s ? (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>
            {s.icon}{s.label}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">No response yet</span>
        )
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-muted/40 text-muted-foreground border-border">
          Attending
        </span>
      )}

      {note && MANAGEMENT_KEYS.includes(colors.value) && (
        <span className="text-xs text-muted-foreground truncate ml-auto max-w-[160px]" title={note}>
          💬 {note}
        </span>
      )}
    </div>
  );
}

// ── Calendar bar preview ──────────────────────────────────────────────────────
function CalendarBarPreview({ attendees, rsvpMap }: { attendees: string[]; rsvpMap: RSVPMap }) {
  const style = attendeePillStyle(attendees, rsvpMap);
  const declined     = attendees.filter(a => MANAGEMENT_KEYS.includes(a) && rsvpMap[a] === "no");
  const activeCount  = attendees.length - declined.length;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Calendar bar preview
      </p>
      <div className="h-6 w-full rounded" style={style} />
      <div className="flex gap-3 text-[11px] text-muted-foreground">
        <span className="text-green-600 font-medium">✓ {activeCount} attending</span>
        {declined.length > 0 && (
          <span className="text-red-500 font-medium">✗ {declined.map(labelForValue).join(", ")} declined</span>
        )}
      </div>
    </div>
  );
}

// ── Main Dialog ───────────────────────────────────────────────────────────────
export function EventDialog({
  open, onOpenChange, event, defaultDate, canEdit,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  event: EventRow | null; defaultDate?: Date; canEdit: boolean;
}) {
  const { role, user: authUser, profile } = useAuth();
  const [, bumpColors] = useState(0);
  useEffect(() => {
    if (open) void loadUnitOverrides().then(() => bumpColors(n => n + 1));
  }, [open]);
  const canEditReport = canEdit && (!event || event.created_by === authUser?.id);
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [type, setType]               = useState<EventType>("meeting");
  const [location, setLocation]       = useState("");
  const [start, setStart]             = useState("");
  const [end, setEnd]                 = useState("");
  const [notes, setNotes]             = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [attendees, setAttendees]     = useState<string[]>([]);
  const [busy, setBusy]               = useState(false);
  const [customType, setCustomType]   = useState("");
  const [needsReport, setNeedsReport] = useState(false);
  const [reportDue, setReportDue]     = useState("");
  const [reportBy, setReportBy]       = useState<string[]>([]);
  const [origReportBy, setOrigReportBy] = useState<string[]>([]);
  const [reportCategory, setReportCategory] = useState("");

  // RSVP — only RD writes to this
  const [rsvpMap, setRsvpMap]     = useState<RSVPMap>({});
  const [rsvpNotes, setRsvpNotes] = useState<Partial<Record<string, string>>>({});

  // RD UI state
  const [showProposeTime, setShowProposeTime] = useState(false);
  const [proposeStart, setProposeStart]       = useState("");
  const [proposeEnd, setProposeEnd]           = useState("");
  const [proposeNote, setProposeNote]         = useState("");
  const [showAddNote, setShowAddNote]         = useState(false);
  const [directorNote, setDirectorNote]       = useState("");
  const [rsvpCollapsed, setRsvpCollapsed]     = useState(false);
  const [rsvpBusy, setRsvpBusy]               = useState(false);
  const [creatorName, setCreatorName]         = useState<string | null>(null);

  const [adminRsvpCollapsed, setAdminRsvpCollapsed] = useState(false);

  // Which management tag (RD / JBT / SBB) the logged-in user answers for in this event
  const me = { email: profile?.email ?? authUser?.email, fullName: profile?.full_name, role, unit: profile?.unit };
  const myKey = MANAGEMENT_KEYS.find(k => attendees.includes(k) && isAssignedTo([k], me)) ?? null;
  const myRsvp: RSVPStatus = myKey ? rsvpMap[myKey] ?? null : null;
  useEffect(() => { setDirectorNote(myKey ? rsvpNotes[myKey] ?? "" : ""); }, [myKey, rsvpNotes]);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDescription(event.description ?? "");
      setType(event.event_type);
      setCustomType((event as any).custom_type ?? "");
      setLocation(event.location ?? "");
      setNotes(event.notes ?? "");
      setMeetingLink(event.meeting_link ?? "");
      const att = (event as any).attendees ?? [];
      setAttendees(att);
      setStart(format(new Date(event.start_time), "yyyy-MM-dd'T'HH:mm"));
      setEnd(format(new Date(event.end_time), "yyyy-MM-dd'T'HH:mm"));

      const raw = (event as any).rsvp_responses;
      const map: RSVPMap =
        raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      setRsvpMap(map);

      const rawNotes = (event as any).rsvp_notes;
      const nts: Partial<Record<string, string>> =
        rawNotes && typeof rawNotes === "object" ? rawNotes : {};
      setRsvpNotes(nts);

      setNeedsReport(false); setReportDue(""); setReportBy([]); setOrigReportBy([]); setReportCategory("");
      void (supabase as any).from("event_reports").select("deadline,assignees,category").eq("event_id", event.id).maybeSingle().then(({ data }: any) => {
        if (!data) return;
        setNeedsReport(true); setReportDue(data.deadline ?? ""); setReportCategory(data.category ?? ""); { const a = Array.isArray(data.assignees) ? data.assignees : []; setReportBy(a); setOrigReportBy(a); }
      });

      // Fetch creator name
      const createdBy = (event as any).created_by;
      if (createdBy) {
        supabase.from("profiles").select("full_name").eq("id", createdBy).maybeSingle().then(({ data }) => {
          setCreatorName(data?.full_name ?? null);
        });
      } else {
        setCreatorName(null);
      }
    } else {
      const d = defaultDate ?? new Date();
      const s = new Date(d); s.setHours(9, 0, 0, 0);
      const e = new Date(d); e.setHours(10, 0, 0, 0);
      setTitle(""); setDescription(""); setType("meeting"); setCustomType("");
      setLocation(""); setNotes(""); setMeetingLink(""); setAttendees([]);
      setStart(format(s, "yyyy-MM-dd'T'HH:mm"));
      setEnd(format(e, "yyyy-MM-dd'T'HH:mm"));
      setRsvpMap({}); setRsvpNotes({});
      setCreatorName(null);
      setNeedsReport(false); setReportDue(""); setReportBy([]); setReportCategory("");
    }
    setShowProposeTime(false); setShowAddNote(false);
    setProposeStart(""); setProposeEnd(""); setProposeNote("");
    setRsvpCollapsed(false); setAdminRsvpCollapsed(false);
  }, [event, defaultDate, open]);

  // ── Admin save ───────────────────────────────────────────────────────────
  const save = async () => {
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      title, description, event_type: type, custom_type: (type as string) === "other" ? customType.trim() || null : null, location, notes, meeting_link: meetingLink || null, attendees,
      start_time: new Date(start).toISOString(),
      end_time:   new Date(end).toISOString(),
    } as any;
    let res;
    if (event) res = await supabase.from("events").update(payload).eq("id", event.id).select().single();
    else        res = await supabase.from("events").insert({ ...payload, created_by: user!.id }).select().single();
    setBusy(false);
    if (res.error) return toast.error(res.error.message);

    if (!canEditReport) {
      // only the event creator manages the report settings
    } else if (needsReport) {
      const { error: rErr } = await (supabase as any).from("event_reports").upsert(
        { event_id: res.data.id, deadline: reportDue || null, category: reportCategory || null, assignees: reportBy, updated_by: user!.id, updated_at: new Date().toISOString() },
        { onConflict: "event_id" });
      if (rErr) toast.warning("Event saved, but report failed: " + rErr.message);
      else await notifyReportAssignees(
        reportBy.filter(a => !origReportBy.includes(a)), user!.id,
        `Report assigned: ${title}`,
        `You are assigned to make the report${reportDue ? ` — due ${format(new Date(reportDue + "T00:00"), "MMM d, yyyy")}` : ""}.`,
      );
    } else if (event) {
      await (supabase as any).from("event_reports").delete().eq("event_id", res.data.id);
    }

    await logAudit("event", res.data.id, event ? "updated" : "created", { title });
    const evDate = format(new Date(start), "MMM d, yyyy 'at' h:mm a");
    const prevAttendees: string[] = (event as any)?.attendees ?? [];
    await notifyReportAssignees(
      attendees.filter(a => !prevAttendees.includes(a)), user!.id,
      `You're invited: ${title}`,
      `${evDate}${location ? ` · ${location}` : ""}${MANAGEMENT_KEYS.some(k => attendees.includes(k)) ? " — please respond (Going?)" : ""}`,
      `/calendar?open=${res.data.id}`, "attendees",
    );
    if (event) {
      await notifyDirectors(`Event updated: ${title}`, `Rescheduled or updated — ${evDate}${location ? ` · ${location}` : ""}`);
    } else {
      await notifyDirectors(`New event: ${title}`, `Scheduled for ${evDate}${location ? ` · ${location}` : ""}`);
    }
    toast.success(event ? "Event updated" : "Event created");
    onOpenChange(false);
  };

  const del = async () => {
    if (!event) return;
    setBusy(true);
    const { error } = await supabase.from("events").delete().eq("id", event.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    await logAudit("event", event.id, "deleted", { title: event.title });
    await notifyDirectors(`Event cancelled: ${event.title}`, `This event has been removed from the calendar.`);
    toast.success("Event deleted"); onOpenChange(false);
  };

  // ── RD: save RSVP ───────────────────────────────────────────────────────
  const saveRsvp = async (status: RSVPStatus) => {
    if (!event || !myKey) return;
    setRsvpBusy(true);

    // Optimistic update — update UI immediately before DB call
    const previousMap  = rsvpMap;
    setRsvpMap({ ...(rsvpMap ?? {}), [myKey]: status });

    const { error } = await (supabase.rpc as any)("set_event_rsvp", { p_event_id: event.id, p_key: myKey, p_status: status });

    setRsvpBusy(false);

    if (error) {
      // Rollback on failure
      setRsvpMap(previousMap);
      return toast.error(error.message);
    }

    const label = status === "yes" ? "Going" : status === "no" ? "Not going" : "Maybe";
    const who = profile?.full_name || labelForValue(myKey);
    await notifyOrganizer(
      event.created_by, authUser?.id ?? "",
      `${who} responded: ${label}`,
      `For event "${event.title}" — ${who} marked as ${label}.`,
      `/calendar?open=${event.id}`,
    );
    toast.success(
      status === "yes"   ? "✅ Marked as Going!" :
      status === "no"    ? "❌ Marked as Not going" :
                           "🤔 Marked as Maybe"
    );
  };

  const submitProposedTime = async () => {
    if (!event || !proposeStart || !proposeEnd) return;
    setRsvpBusy(true);
    const { error } = await supabase.from("events").update({
      proposed_start: new Date(proposeStart).toISOString(),
      proposed_end:   new Date(proposeEnd).toISOString(),
      proposed_note:  proposeNote,
    }).eq("id", event.id);
    setRsvpBusy(false);
    if (error) return toast.error(error.message);
    await notifyOrganizer(
      event.created_by, authUser?.id ?? "",
      `${profile?.full_name || "Management"} proposed a new time`,
      `For event "${event.title}" — please review the proposed schedule.`,
      `/calendar?open=${event.id}`,
    );
    toast.success("Proposed time sent to admin");
    setShowProposeTime(false);
  };

  const saveNote = async () => {
    if (!event || !myKey) return;
    setRsvpBusy(true);
    const updatedNotes = { ...(rsvpNotes ?? {}), [myKey]: directorNote };
    const { error } = await (supabase.rpc as any)("set_event_rsvp", { p_event_id: event.id, p_key: myKey, p_note: directorNote, p_set_note: true });
    setRsvpBusy(false);
    if (error) return toast.error(error.message);
    setRsvpNotes(updatedNotes);
    await notifyOrganizer(
      event.created_by, authUser?.id ?? "",
      `${profile?.full_name || labelForValue(myKey)} added a note`,
      `For event "${event.title}": "${directorNote}"`,
      `/calendar?open=${event.id}`,
    );
    toast.success("Note saved"); setShowAddNote(false);
  };

  // Admin badge counts — only management (RD/JBT/SBB) can RSVP
  const mgmtInEvent  = attendees.filter(a => MANAGEMENT_KEYS.includes(a));
  const rdInEvent    = mgmtInEvent.length > 0;
  const yesCount     = mgmtInEvent.filter(k => rsvpMap[k] === "yes").length;
  const noCount      = mgmtInEvent.filter(k => rsvpMap[k] === "no").length;
  const maybeCount   = mgmtInEvent.filter(k => rsvpMap[k] === "maybe").length;
  const pendingCount = mgmtInEvent.filter(k => !rsvpMap[k]).length;
  const hasDeclines  = noCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {event ? (canEdit ? "Edit event" : "Event Details") : "New event"}
          </DialogTitle>
        </DialogHeader>

        {/* ══ ADMIN FORM ════════════════════════════════════════════════════ */}
        {canEdit && (<fieldset className="space-y-3">
          <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={v => setType(v as EventType)} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
  <SelectItem value="attendance_to_meeting">Attendance to Meeting/Activities</SelectItem>
  <SelectItem value="competency_based_interview">Competency Based Interview</SelectItem>
  <SelectItem value="courtesy_visit">Courtesy Visit</SelectItem>
  <SelectItem value="data_processing">Data Processing</SelectItem>
  <SelectItem value="directorate_meeting">Directorate Meeting</SelectItem>
  <SelectItem value="event">Event</SelectItem>
  <SelectItem value="field_supervision">Field Supervision</SelectItem>
  <SelectItem value="investigation">Investigation</SelectItem>
  <SelectItem value="interagency_meeting">Interagency Meeting</SelectItem>
  <SelectItem value="kasalan_ng_bayan">Kasalan ng Bayan</SelectItem>
  <SelectItem value="lcro_audit">LCRO Audit</SelectItem>
  <SelectItem value="meeting">Meeting</SelectItem>
  <SelectItem value="mobile_serbisyo_caravan">Mobile Serbisyo Caravan</SelectItem>
  <SelectItem value="national_data_review">National Data Review</SelectItem>
  <SelectItem value="one_stop_shop">One Stop Shop</SelectItem>
  <SelectItem value="on_leave">On Leave</SelectItem>
  <SelectItem value="personal">Personal</SelectItem>
  <SelectItem value="press_conference">Press Conference</SelectItem>
  <SelectItem value="regional_data_review">Regional Data Review</SelectItem>
  <SelectItem value="robac_meeting">ROBAC Meeting</SelectItem>
  <SelectItem value="senior_staff_meeting">Senior Staff Meeting</SelectItem>
  <SelectItem value="training_conduct">Training (Conduct)</SelectItem>
  <SelectItem value="other">Other</SelectItem>
</SelectContent>
              </Select>
              {(type as string) === "other" && (
                <Input className="mt-1.5" placeholder="Specify type" value={customType} onChange={e => setCustomType(e.target.value)} disabled={!canEdit} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Notes / agenda</Label>
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Meeting link</Label>
            <Input
              type="url"
              placeholder="https://meet.google.com/xxx-xxxx-xxx"
              value={meetingLink}
              onChange={e => setMeetingLink(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Who will attend</Label>
            <AttendeeSelect value={attendees} onChange={setAttendees} disabled={!canEdit} />
          </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input type="checkbox" checked={needsReport} disabled={!canEditReport} onChange={e => setNeedsReport(e.target.checked)} />
              Requires a report
            </label>
            {needsReport && (
              <>
                <div className="space-y-1.5">
                  <Label>Report type</Label>
                  <select value={reportCategory} onChange={e => setReportCategory(e.target.value)} disabled={!canEditReport}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60">
                    <option value="">Select report type…</option>
                    <option value="pl">Partnership and Linkage (P&amp;L)</option>
                    <option value="info_dissemination">Information Dissemination</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Report due date</Label>
                  <Input type="date" value={reportDue} onChange={e => setReportDue(e.target.value)} disabled={!canEditReport} />
                </div>
                <div className="space-y-1.5">
                  <Label>Who will make the report</Label>
                  <AttendeeSelect value={reportBy} onChange={setReportBy} disabled={!canEditReport} />
                </div>
              </>
            )}
          </div>
        </fieldset>)}

        {/* ══ ADMIN: JOIN MEETING LINK ════════════════════════════════════ */}
        {canEdit && !!event && !!event.meeting_link && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
            <Video className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-0.5">Online Meeting</p>
              <a
                href={event.meeting_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate block"
              >
                {event.meeting_link}
              </a>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(event.meeting_link!); toast.success("Link copied"); }}
                className="p-1.5 rounded-md text-blue-500 hover:bg-blue-100 transition-colors"
                title="Copy link"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <a
                href={event.meeting_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                <Video className="w-3.5 h-3.5" />Join
              </a>
            </div>
          </div>
        )}

        {/* ══ DIRECTOR BRIEF VIEW ════════════════════════════════════════════ */}
        {!canEdit && !!event && (
          <div className="divide-y divide-border -mt-1">
            {/* Type badge + title */}
            <div className="pb-4 space-y-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${EVENT_TYPE_BADGE[event.event_type] ?? "bg-amber-100 text-amber-700 border border-amber-200"}`}>
                {eventTypeLabel(event as any)}
              </span>
              <h2 className="text-xl font-bold text-foreground leading-tight">{event.title}</h2>
              {creatorName && (
                <p className="text-xs text-muted-foreground">Created by {creatorName}</p>
              )}
            </div>

            {/* Date & time */}
            <div className="py-4 flex items-start gap-3">
              <CalendarDays className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {format(parseISO(event.start_time), "EEEE, MMMM d, yyyy")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {format(parseISO(event.start_time), "h:mm a")} – {format(parseISO(event.end_time), "h:mm a")}
                </p>
              </div>
            </div>

            {/* Location */}
            {event.location && (
              <div className="py-4 flex items-start gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-sm text-foreground">{event.location}</p>
              </div>
            )}

            {/* Description */}
            {event.description && (
              <div className="py-4 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Description</p>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{event.description}</p>
              </div>
            )}

            {/* Notes / Agenda */}
            {event.notes && (
              <div className="py-4 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Agenda / Notes</p>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{event.notes}</p>
              </div>
            )}

            {/* Attendees */}
            {attendees.length > 0 && (
              <div className="py-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Attendees</p>
                <div className="flex flex-wrap gap-1.5">
                  {attendees.map(key => {
                    const a = colorForValue(key);
                    return (
                      <span key={key}
                        style={{ background: a.bg, color: a.text, borderColor: a.border }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border">
                        <span style={{ background: a.dot }} className="w-2 h-2 rounded-full" />
                        {labelForValue(key)}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Join meeting — prominent for director */}
            {event.meeting_link && (
              <div className="pt-4 space-y-1.5">
                <a
                  href={event.meeting_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm"
                >
                  <Video className="w-4 h-4" />
                  Join Online Meeting
                </a>
                <p className="text-[11px] text-muted-foreground text-center truncate">{event.meeting_link}</p>
              </div>
            )}
          </div>
        )}

        {/* ══ ADMIN: RSVP RESPONSE PANEL ════════════════════════════════════ */}
        {canEdit && !!event && attendees.length > 0 && (
          <div className="rounded-xl border border-border overflow-hidden mt-1">
            <button
              type="button"
              onClick={() => setAdminRsvpCollapsed(c => !c)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Attendance responses</span>
                {rdInEvent && (
                  <div className="flex items-center gap-1">
                    {yesCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200">
                        <CheckCircle2 className="w-3 h-3" />{yesCount} going
                      </span>
                    )}
                    {maybeCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200">
                        <HelpCircle className="w-3 h-3" />{maybeCount} maybe
                      </span>
                    )}
                    {hasDeclines && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">
                        <XCircle className="w-3 h-3" />{noCount} declined
                      </span>
                    )}
                    {pendingCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">{pendingCount} pending</span>
                    )}
                  </div>
                )}
              </div>
              {adminRsvpCollapsed
                ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                : <ChevronUp   className="w-4 h-4 text-muted-foreground" />}
            </button>

            {!adminRsvpCollapsed && (
              <div className="divide-y divide-border">
                {attendees.map(key => (
                  <RSVPSummaryRow
                    key={key}
                    label={labelForValue(key)}
                    colors={colorForValue(key)}
                    status={MANAGEMENT_KEYS.includes(key) ? (rsvpMap[key] ?? null) : null}
                    note={MANAGEMENT_KEYS.includes(key) ? rsvpNotes[key] : undefined}
                  />
                ))}
                <div className="p-3">
                  <CalendarBarPreview attendees={attendees} rsvpMap={rsvpMap} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ RD: GOING? SECTION ════════════════════════════════════════════
            Only shown when RD is in the attendees list                       */}
        {!canEdit && !!event && !!myKey && (
          <div className="mt-2 rounded-xl border border-border bg-muted/30 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-muted/50 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Going?</span>
              <button
                type="button"
                onClick={() => setRsvpCollapsed(c => !c)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {rsvpCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            </div>

            {!rsvpCollapsed && (
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <RSVPBtn
                    status="yes" current={myRsvp}
                    onClick={() => saveRsvp("yes")}
                    icon={<CheckCircle2 className="w-4 h-4" />}
                    label="Yes"
                    activeClass="bg-green-500 text-white border-green-500"
                    disabled={rsvpBusy}
                  />
                  <RSVPBtn
                    status="no" current={myRsvp}
                    onClick={() => saveRsvp("no")}
                    icon={<XCircle className="w-4 h-4" />}
                    label="No"
                    activeClass="bg-red-500 text-white border-red-500"
                    disabled={rsvpBusy}
                  />
                  <RSVPBtn
                    status="maybe" current={myRsvp}
                    onClick={() => saveRsvp("maybe")}
                    icon={<HelpCircle className="w-4 h-4" />}
                    label="Maybe"
                    activeClass="bg-yellow-400 text-white border-yellow-400"
                    disabled={rsvpBusy}
                  />
                  <div className="h-6 w-px bg-border mx-1" />
                  <button type="button"
                    onClick={() => { setShowProposeTime(p => !p); setShowAddNote(false); }}
                    className={[
                      "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all",
                      showProposeTime
                        ? "bg-blue-50 border-blue-300 text-blue-700"
                        : "border-border text-muted-foreground bg-background hover:bg-muted/50",
                    ].join(" ")}>
                    <CalendarClock className="w-4 h-4" />Propose a new time
                  </button>
                  <button type="button"
                    onClick={() => { setShowAddNote(n => !n); setShowProposeTime(false); }}
                    className={[
                      "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all",
                      showAddNote
                        ? "bg-purple-50 border-purple-300 text-purple-700"
                        : "border-border text-muted-foreground bg-background hover:bg-muted/50",
                    ].join(" ")}>
                    <MessageSquarePlus className="w-4 h-4" />Add note
                  </button>
                </div>

                {/* Current response badge */}
                {myRsvp && (
                  <div className={[
                    "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
                    myRsvp === "yes"   ? "bg-green-50  border-green-200  text-green-700"  :
                    myRsvp === "no"    ? "bg-red-50    border-red-200    text-red-700"    :
                                         "bg-yellow-50 border-yellow-200 text-yellow-700",
                  ].join(" ")}>
                    {myRsvp === "yes"   ? <CheckCircle2 className="w-3 h-3" /> :
                     myRsvp === "no"    ? <XCircle      className="w-3 h-3" /> :
                                          <HelpCircle   className="w-3 h-3" />}
                    Your response: <span className="font-semibold capitalize">{myRsvp}</span>
                  </div>
                )}

                {/* Propose time panel */}
                {showProposeTime && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2.5">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Propose a new time</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-blue-700">New start</Label>
                        <Input type="datetime-local" value={proposeStart} onChange={e => setProposeStart(e.target.value)} className="text-xs h-8 border-blue-200" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-blue-700">New end</Label>
                        <Input type="datetime-local" value={proposeEnd} onChange={e => setProposeEnd(e.target.value)} className="text-xs h-8 border-blue-200" />
                      </div>
                    </div>
                    <Textarea rows={2} value={proposeNote} onChange={e => setProposeNote(e.target.value)} placeholder="Reason (optional)…" className="text-xs border-blue-200 resize-none" />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setShowProposeTime(false)}>Cancel</Button>
                      <Button size="sm" className="text-xs h-7 bg-blue-600 hover:bg-blue-700 text-white" onClick={submitProposedTime} disabled={rsvpBusy || !proposeStart || !proposeEnd}>
                        Send proposal
                      </Button>
                    </div>
                  </div>
                )}

                {/* Add note panel */}
                {showAddNote && (
                  <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-3 space-y-2.5">
                    <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Add a note</p>
                    <Textarea rows={3} value={directorNote} onChange={e => setDirectorNote(e.target.value)} placeholder="Notes for the organizer…" className="text-xs border-purple-200 resize-none" />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setShowAddNote(false)}>Cancel</Button>
                      <Button size="sm" className="text-xs h-7 bg-purple-600 hover:bg-purple-700 text-white" onClick={saveNote} disabled={rsvpBusy || !directorNote.trim()}>
                        Save note
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* RD not in attendees list */}
        {!canEdit && !!event && !myKey && !isAssignedTo(attendees, me) && (
          <div className="mt-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            You are not listed as an attendee for this event.
          </div>
        )}

        {/* ══ FOOTER ════════════════════════════════════════════════════════ */}
        <DialogFooter className="gap-2 pt-2">
          {event && canEdit && <Button variant="destructive" onClick={del} disabled={busy}>Delete</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{canEdit ? "Cancel" : "Close"}</Button>
          {canEdit && <Button onClick={save} disabled={busy || !title || !start || !end}>{event ? "Save" : "Create"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}