import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth";
import { resolveNotifLink } from "@/lib/notif-link";

export const Route = createFileRoute("/_app/notifications")({ component: Notifications });

function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      setItems(data ?? []);
    };
    void load();
    const ch = supabase.channel("notif").on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, load).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user]);

  const markAll = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    setItems(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleClick = async (n: any) => {
    if (!n.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    }
    const target = await resolveNotifLink(n);
    if (target) void navigate({ to: target.path as never, search: target.search as never });
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader icon={Bell} title="Notifications" subtitle={`${items.filter(n => !n.read).length} unread · reminders, assignments and updates`}>
        <Button variant="outline" onClick={markAll} className="rounded-full"><CheckCheck className="h-4 w-4 mr-1"/>Mark all read</Button>
      </PageHeader>
      {items.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground"><Bell className="h-8 w-8 mx-auto mb-2 opacity-50"/>No notifications yet.</Card>
      )}
      <div className="stagger space-y-2">
        {items.map(n => (
          <Card
            key={n.id}
            onClick={() => handleClick(n)}
            className={[
              "p-4 flex items-start gap-3 transition-all duration-200",
              n.link ? "cursor-pointer hover:bg-muted/50 hover:translate-x-1" : "",
              !n.read ? "bg-primary/5 border-primary/30 border-l-4 border-l-[var(--brand-red)] shadow-sm" : "opacity-70",
            ].join(" ")}>
            <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read ? "bg-muted-foreground/40" : "bg-primary"}`}/>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className={`font-medium ${!n.read ? "text-foreground" : "text-muted-foreground"}`}>{n.title}</div>
                <div className="text-xs text-muted-foreground shrink-0">{format(parseISO(n.created_at), "MMM d, p")}</div>
              </div>
              {n.body && <p className="text-sm text-muted-foreground mt-1">{n.body}</p>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
