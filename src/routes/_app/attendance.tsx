import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { format, parseISO, addDays } from "date-fns";
import { Users, Clock, Coffee, LogOut, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays as CalendarIcon } from "lucide-react";

export const Route = createFileRoute("/_app/attendance")({ component: AttendancePage });

type AttendanceStatusRow = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  attendance_date: string;
  check_in_time: string | null;
  break_out_time: string | null;
  break_in_time: string | null;
  check_out_time: string | null;
  check_in_status: string;
  break_out_status: string;
  break_in_status: string;
  day_status: string;
};

function DatePickerButton({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(date);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="font-medium w-44 justify-center">
          <CalendarIcon className="h-4 w-4 mr-2" />{format(selected, "EEE, MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          disabled={{ after: new Date() }}
          onSelect={d => { if (d) { onChange(format(d, "yyyy-MM-dd")); setOpen(false); } }}
        />
      </PopoverContent>
    </Popover>
  );
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return format(new Date(iso), "h:mm a");
}

function DayStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    "Complete":      "bg-green-100 text-green-700 border-green-200",
    "Working (AM)":  "bg-blue-100 text-blue-700 border-blue-200",
    "Working (PM)":  "bg-blue-100 text-blue-700 border-blue-200",
    "On Break":      "bg-amber-100 text-amber-700 border-amber-200",
    "Absent":        "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      {status}
    </span>
  );
}

function CheckInStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    on_time:        "bg-green-100 text-green-700",
    late:           "bg-amber-100 text-amber-700",
    absent:         "bg-red-100 text-red-700",
    missed_window:  "bg-red-100 text-red-700",
    not_checked_in: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    on_time:        "On time",
    late:           "Late",
    absent:         "Absent",
    missed_window:  "Missed",
    not_checked_in: "Pending",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cfg[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}

function AttendancePage() {
  const { role } = useAuth();
  const todayStr = format(new Date(), "yyyy-MM-dd");
const [date, setDate] = useState(todayStr);
  const [rows, setRows] = useState<AttendanceStatusRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("attendance_status")
        .select("*")
        .eq("attendance_date", date)
        .order("full_name");
      setRows((data ?? []) as AttendanceStatusRow[]);
      setLoading(false);
    };
    void load();

    // Live updates — refresh when any attendance row changes
    const ch = supabase.channel("attendance-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, load)
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [date]);

  // Guard — admin/director only (after hooks)
  if (role !== "admin" && role !== "director") {
    return <Navigate to="/calendar" />;
  }

  const prevDay = () => setDate(format(addDays(parseISO(date), -1), "yyyy-MM-dd"));
  const nextDay = () => setDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"));
  const isToday = date === format(new Date(), "yyyy-MM-dd");

  // Summary counts
  const total    = rows.length;
  const complete = rows.filter(r => r.day_status === "Complete").length;
  const working  = rows.filter(r => r.day_status.startsWith("Working")).length;
  const onBreak  = rows.filter(r => r.day_status === "On Break").length;
  const absent   = rows.filter(r => r.day_status === "Absent").length;

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Attendance</h1>
          <p className="text-sm text-muted-foreground">WFH attendance tracking</p>
        </div>
        {/* Date navigator */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevDay}><ChevronLeft className="h-4 w-4"/></Button>
          <DatePickerButton date={date} onChange={setDate} />
          <Button variant="outline" size="icon" onClick={nextDay} disabled={isToday}><ChevronRight className="h-4 w-4"/></Button>
          {!isToday && (
            <Button variant="outline" size="sm" onClick={() => setDate(format(new Date(), "yyyy-MM-dd"))}>
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard icon={<Users className="w-4 h-4"/>}     label="Total"    value={total}    color="text-foreground" />
        <SummaryCard icon={<CheckCircle2 className="w-4 h-4"/>} label="Complete" value={complete} color="text-green-600" />
        <SummaryCard icon={<Clock className="w-4 h-4"/>}     label="Working"  value={working}  color="text-blue-600" />
        <SummaryCard icon={<AlertCircle className="w-4 h-4"/>} label="Absent"  value={absent}   color="text-red-600" />
      </div>

      {/* Attendance table */}
      <Card className="shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Check-in</th>
                <th className="px-4 py-3 text-center">Break Out</th>
                <th className="px-4 py-3 text-center">Break In</th>
                <th className="px-4 py-3 text-center">Check-out</th>
                <th className="px-4 py-3 text-center">Check-in Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-xs">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-xs">
                    No attendance records for this date.
                  </td>
                </tr>
              )}
              {rows.map(r => (
                <tr key={r.id ?? r.user_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <DayStatusBadge status={r.day_status} />
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">
                    {fmtTime(r.check_in_time)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">
                    {fmtTime(r.break_out_time)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">
                    {fmtTime(r.break_in_time)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">
                    {fmtTime(r.check_out_time)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <CheckInStatusBadge status={r.check_in_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number; color: string;
}) {
  return (
    <Card className="shadow-soft p-4 flex items-center gap-3">
      <span className={color}>{icon}</span>
      <div>
        <div className={`text-xl font-bold ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}