import { Link, useLocation, Outlet, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard, Calendar, Users2, Bell, FileBarChart2,
  UserCircle2, LogOut, Sun, Moon, Menu, X, CheckCheck,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { resolveNotifLink } from "@/lib/notif-link";
import { format, parseISO } from "date-fns";
import { InstallButton } from "@/components/ui/InstallPrompt";

const NAV = [
  { to: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard, restricted: false, adminOnly: false },
  { to: "/calendar",      label: "Calendar",       icon: Calendar,        restricted: false, adminOnly: false },
  { to: "/meetings",      label: "Meetings",       icon: Users2,          restricted: false, adminOnly: false },
  { to: "/notifications", label: "Notifications",  icon: Bell,            restricted: false, adminOnly: false },
  { to: "/reports",       label: "Reports",        icon: FileBarChart2,   restricted: false, adminOnly: false },
  { to: "/manage-units",  label: "Manage Units",   icon: ShieldCheck,     restricted: false, adminOnly: true  },
  { to: "/profile",       label: "Profile",        icon: UserCircle2,     restricted: false, adminOnly: false },
] as const;

export function Shell() {
  const { profile, role, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<any[]>([]);
  const bellRef = useRef<HTMLDivElement>(null);

  const isAdmin = role === "admin";
  const filteredNav = NAV.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  useEffect(() => { setOpen(false); }, [loc.pathname]);

  useEffect(() => {
    if (!profile) return;
    const load = async () => {
      const [{ count }, { data }] = await Promise.all([
        supabase.from("notifications").select("*", { count: "exact", head: true }).eq("read", false).eq("user_id", profile.id),
        supabase.from("notifications").select("*").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(8),
      ]);
      setUnread(count ?? 0);
      setNotifItems(data ?? []);
    };
    void load();
    const ch = supabase.channel("notif-count").on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, load).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [profile]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markOneRead = async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    if (!profile) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", profile.id).eq("read", false);
    setNotifItems(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
  };

  const initials = (profile?.full_name || profile?.email || "?").split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="relative flex items-center justify-between px-5 py-5 border-b border-sidebar-border overflow-hidden">
          <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-white/5" />
          <Link to="/dashboard" className="group relative flex items-center gap-3">
            <span className="grid place-items-center h-11 w-11 rounded-full bg-white p-0.5 shadow-lg ring-2 ring-white/20 transition-transform duration-300 group-hover:rotate-[360deg] group-hover:scale-105">
              <img src="/ncsc-logo.png" alt="NCSC" className="h-full w-full" draggable={false} />
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-[0.18em]">CARES</span>
              <span className="block text-[10px] uppercase tracking-wider text-sidebar-foreground/60">NCSC</span>
            </span>
          </Link>
          <button className="lg:hidden relative" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5"/></button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {filteredNav.map(({ to, label, icon: Icon }) => {
            const active = loc.pathname.startsWith(to);
            return (
              <Link key={to} to={to}
                className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground hover:translate-x-1"}`}>
                <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-[var(--brand-red)] transition-all duration-200 ${active ? "opacity-100" : "opacity-0 scale-y-0"}`} />
                <Icon className={`h-4 w-4 transition-transform duration-200 group-hover:scale-110 ${active ? "text-white" : ""}`} />
                <span className="flex-1">{label}</span>
                {to === "/notifications" && unread > 0 && (
                  <Badge variant="secondary" className="bg-[var(--brand-red)] text-white border-0 animate-pulse">{unread}</Badge>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-2 rounded-xl bg-sidebar-accent/40">
            <Avatar className="h-9 w-9 shrink-0 ring-2 ring-white/20">
              <AvatarImage src={(profile as any)?.avatar_url ?? undefined} alt={profile?.full_name ?? "User"} />
              <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium leading-tight truncate" title={profile?.full_name ?? "User"}>{profile?.full_name ?? "User"}</div>
              <div
                className="text-[11px] text-sidebar-foreground/70 leading-snug break-words line-clamp-2"
                title={(profile as any)?.position ?? role ?? "—"}
              >
                {(profile as any)?.position ?? role ?? "—"}
              </div>
            </div>
            <button
              onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
              className="p-2 hover:bg-[var(--brand-red)] hover:text-white rounded-md shrink-0 transition-colors"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4"/>
            </button>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 h-16 flex items-center gap-3 px-4 sm:px-6 bg-background/80 backdrop-blur-md border-b border-border shadow-[0_1px_0_0_color-mix(in_oklab,var(--brand-red)_25%,transparent)]">
          <button className="lg:hidden p-2 -ml-2" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5"/></button>
          <div className="flex-1 hidden sm:block">
            <div className="text-sm font-semibold capitalize leading-tight">{loc.pathname.split("/")[1]?.replace(/-/g, " ") || "dashboard"}</div>
            <div className="text-xs text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy")}</div>
          </div>
          <div className="flex-1 sm:hidden" />
          <InstallButton className="hidden sm:inline-flex" />
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
          </Button>
          <div ref={bellRef} className="relative">
            <button
              onClick={() => setNotifOpen(v => !v)}
              className="relative p-2 rounded-full hover:bg-muted transition-colors"
              aria-label="Notifications">
              <Bell className={`h-5 w-5 transition-transform ${unread > 0 ? "animate-ring" : ""}`}/>
              {unread > 0 && (
                <span className="absolute top-1 right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"/>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"/>
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background shadow-lg z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-semibold text-sm">Notifications</span>
                  {unread > 0 && (
                    <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <CheckCheck className="h-3 w-3"/>Mark all read
                    </button>
                  )}
                </div>
                <ul className="max-h-96 overflow-y-auto divide-y divide-border">
                  {notifItems.length === 0 && (
                    <li className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet.</li>
                  )}
                  {notifItems.map(n => (
                    <li key={n.id}
                      onClick={async () => { if (!n.read) markOneRead(n.id); if (n.link) { setNotifOpen(false);
                        const target = await resolveNotifLink(n);
                        if (target) navigate({ to: target.path as never, search: target.search as never }); } }}
                      className={[
                        "px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors",
                        !n.read ? "bg-primary/5" : "",
                      ].join(" ")}>
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read ? "bg-muted-foreground/30" : "bg-primary"}`}/>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate ${!n.read ? "font-semibold" : "text-muted-foreground"}`}>{n.title}</div>
                          {n.body && <div className="text-xs text-muted-foreground truncate mt-0.5">{n.body}</div>}
                          <div className="text-[10px] text-muted-foreground/70 mt-1">{format(parseISO(n.created_at), "MMM d, p")}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="px-4 py-2 border-t border-border">
                  <Link to="/notifications" onClick={() => setNotifOpen(false)} className="text-xs text-primary hover:underline">View all notifications</Link>
                </div>
              </div>
            )}
          </div>
        </header>
        <main key={loc.pathname} className="p-4 sm:p-6 lg:p-8 animate-fade-in-up"><Outlet /></main>
      </div>
    </div>
  );
}