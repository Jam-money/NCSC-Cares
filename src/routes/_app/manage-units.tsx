import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Navigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { UserPlus, Pencil, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { enrollUser } from "@/lib/enroll-user.functions";

export const Route = createFileRoute("/_app/manage-units")({ component: ManageUnitsPage });

type AppUnit = "CRASD" | "SOCD" | "ORD";
type EmploymentType = "regular" | "cosw" | "jo" | "lgu" | "gip";
const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  cosw:    { label: "COSW",    cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  jo:      { label: "JO",      cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  lgu:     { label: "LGU", cls: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  gip:     { label: "GIP", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
};

interface Row {
  id: string;
  full_name: string | null;
  email: string | null;
  position: string | null;
  unit: AppUnit | null;
  employment_type?: EmploymentType | null;
}

function ManageUnitsPage() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRows = async () => {
    const { data, error } = await (supabase as any)
      .from("profiles")
      .select("id,full_name,email,position,unit,employment_type")
      .order("full_name");
    if (error) {
      toast.error("Failed to load users");
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (role !== "admin") return;
    void loadRows();
  }, [role]);

  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", position: "", unit: "" as AppUnit | "", employmentType: "regular" as EmploymentType });
  const [saving, setSaving] = useState(false);
  const openEdit = (r: Row) => {
    setEditRow(r);
    setEditForm({ fullName: r.full_name ?? "", position: r.position ?? "", unit: r.unit ?? "", employmentType: r.employment_type ?? "regular" });
  };
  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    const patch = {
      full_name: editForm.fullName.trim() || null,
      position: editForm.position.trim() || null,
      unit: editForm.unit || null,
      employment_type: editForm.employmentType,
    };
    const { error } = await (supabase as any).from("profiles").update(patch).eq("id", editRow.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    setRows(prev => prev.map(r => (r.id === editRow.id ? { ...r, ...patch } as Row : r)));
    toast.success("User updated");
    setEditRow(null);
  };

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const emptyForm = { fullName: "", email: "", password: "", position: "", unit: "SOCD" as "SOCD" | "CRASD", employmentType: "regular" as EmploymentType };
  const [form, setForm] = useState(emptyForm);
  const submitEnroll = async () => {
    setEnrolling(true);
    try {
      await enrollUser({ data: form });
      toast.success(`${form.fullName} enrolled as ${form.employmentType.toUpperCase()} (${form.unit})`);
      setEnrollOpen(false); setForm(emptyForm);
      await loadRows();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to enroll user");
    } finally {
      setEnrolling(false);
    }
  };

  const MANAGEMENT_NAMES = ["tuason", "balagbis", "aves"];
  const isMgmt = (r: Row) => {
    const hay = `${r.full_name ?? ""} ${(r.email ?? "").split("@")[0]}`.toLowerCase();
    return MANAGEMENT_NAMES.some(n => hay.includes(n));
  };
  const staffRows = rows.filter(r => !isMgmt(r));
  const [tab, setTab] = useState<"ALL" | "NONE" | "MGMT" | AppUnit>("ALL");
  const [search, setSearch] = useState("");
  const matchesSearch = (r: Row) => {
    const t = search.trim().toLowerCase();
    return !t || (r.full_name ?? "").toLowerCase().includes(t) || (r.email ?? "").toLowerCase().includes(t);
  };
  const baseSections = ([
    { key: "MGMT",  label: "Management", dot: "#eab308", items: rows.filter(isMgmt) },
    { key: "NONE",  label: "Unassigned", dot: "#94a3b8", items: staffRows.filter(r => !r.unit) },
    { key: "CRASD", label: "CRASD",      dot: "#3b82f6", items: staffRows.filter(r => r.unit === "CRASD") },
    { key: "SOCD",  label: "SOCD",       dot: "#22c55e", items: staffRows.filter(r => r.unit === "SOCD") },
    { key: "ORD",   label: "ORD",        dot: "#ec4899", items: staffRows.filter(r => r.unit === "ORD") },
  ] as const);
  const sections = baseSections.map(s => ({ ...s, items: (tab === "ALL" || tab === s.key) ? s.items.filter(matchesSearch) : [] }));

  // Guard: only admins can access this page
  if (role !== "admin") {
    return <Navigate to="/calendar" />;
  }

  const updateUnit = async (userId: string, unit: AppUnit) => {
    const { error } = await (supabase as any).from("profiles").update({ unit }).eq("id", userId);
    if (error) {
      toast.error("Failed to update unit");
      return;
    }
    setRows(prev => prev.map(r => (r.id === userId ? { ...r, unit } : r)));
    toast.success("Unit updated");
  };

  return (
    <div className="space-y-4 w-full max-w-7xl">
      <PageHeader icon={ShieldCheck} title="Manage Units" subtitle="Assign each user to CRASD, SOCD or ORD. Users only see calendar events from their own unit.">
        <Button onClick={() => setEnrollOpen(true)} className="shadow-md hover:-translate-y-0.5 transition-all"><UserPlus className="h-4 w-4 mr-1.5" />Enroll user</Button>
      </PageHeader>

      <Dialog open={!!editRow} onOpenChange={o => { if (!o) setEditRow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit user</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={editRow?.email ?? ""} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Position</Label>
              <Input value={editForm.position} onChange={e => setEditForm(f => ({ ...f, position: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={editForm.unit || undefined} onValueChange={v => setEditForm(f => ({ ...f, unit: v as AppUnit }))}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRASD">CRASD</SelectItem>
                    <SelectItem value="SOCD">SOCD</SelectItem>
                    <SelectItem value="ORD">ORD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={editForm.employmentType} onValueChange={v => setEditForm(f => ({ ...f, employmentType: v as EmploymentType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="cosw">COSW</SelectItem>
                    <SelectItem value="jo">JO (Job Order)</SelectItem>
                    <SelectItem value="lgu">LGU</SelectItem>
                    <SelectItem value="gip">GIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving || !editForm.fullName.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Enroll user</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="e.g. Juan A. Dela Cruz" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@psa.gov.ph" />
            </div>
            <div className="space-y-1.5">
              <Label>Temporary password</Label>
              <Input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 6 characters" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v as "SOCD" | "CRASD" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SOCD">SOCD</SelectItem>
                    <SelectItem value="CRASD">CRASD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.employmentType} onValueChange={v => setForm(f => ({ ...f, employmentType: v as EmploymentType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="cosw">COSW</SelectItem>
                    <SelectItem value="jo">JO (Job Order)</SelectItem>
                    <SelectItem value="lgu">LGU</SelectItem>
                    <SelectItem value="gip">GIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Position (optional)</Label>
              <Input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} placeholder="e.g. Encoder" />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button onClick={submitEnroll} disabled={enrolling || !form.fullName.trim() || !form.email.trim() || form.password.length < 6}>
              {enrolling ? "Enrolling…" : "Enroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center gap-2">
        {([["ALL", "All"], ["MGMT", "Management"], ["NONE", "Unassigned"], ["CRASD", "CRASD"], ["SOCD", "SOCD"], ["ORD", "ORD"]] as const).map(([key, label]) => {
          const count = key === "ALL" ? rows.length : baseSections.find(s => s.key === key)?.items.length ?? 0;
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
              {label}
              <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>{count}</span>
            </button>
          );
        })}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…"
          className="ml-auto w-56 border border-border rounded-md px-3 py-1.5 bg-background text-sm" />
      </div>

      {loading && <Card className="p-6 text-sm text-muted-foreground shadow-soft">Loading users…</Card>}
      {!loading && sections.every(s => s.items.length === 0) && (
        <Card className="p-6 text-sm text-muted-foreground shadow-soft">No users found.</Card>
      )}

      {sections.filter(s => s.items.length > 0).map(s => (
        <Card key={s.key} className="shadow-soft overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} />
            <h2 className="text-sm font-semibold">{s.label}</h2>
            <span className="text-xs text-muted-foreground">{s.items.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
            {s.items.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-background/40 hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate flex items-center gap-1.5">
                    <span className="truncate">{r.full_name || "—"}</span>
                    {r.employment_type && TYPE_BADGE[r.employment_type] && (
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${TYPE_BADGE[r.employment_type].cls}`}>
                        {TYPE_BADGE[r.employment_type].label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                  {r.position && (
                    <div className="text-xs text-muted-foreground truncate">{r.position}</div>
                  )}
                </div>
                <button onClick={() => openEdit(r)} title="Edit user" aria-label="Edit user"
                  className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <Pencil className="h-4 w-4" />
                </button>
                <Select
                  value={r.unit ?? undefined}
                  onValueChange={v => void updateUnit(r.id, v as AppUnit)}
                >
                  <SelectTrigger className="w-28 shrink-0">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRASD">CRASD</SelectItem>
                    <SelectItem value="SOCD">SOCD</SelectItem>
                    <SelectItem value="ORD">ORD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
