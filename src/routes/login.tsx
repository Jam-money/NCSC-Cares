import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => { if (!loading && session) navigate({ to: "/dashboard" }); }, [session, loading, navigate]);

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div
        className="hidden lg:flex flex-col items-center justify-center text-center relative text-white p-12 overflow-hidden bg-gradient-to-br from-[#1e3a8a] via-[#1e3a8a] to-[#b91c1c] select-none"
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
        }}
        onMouseLeave={() => setPos({ x: 0, y: 0 })}
      >
        <style>{`
          @keyframes cFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
          @keyframes cPulse { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(1.6); opacity: 0; } }
          @keyframes cRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        `}</style>

        <div
          className="pointer-events-none absolute h-[32rem] w-[32rem] rounded-full bg-white/15 blur-3xl transition-transform duration-300 ease-out"
          style={{ transform: `translate(${pos.x * 500}px, ${pos.y * 500}px)` }}
        />
        <div
          className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-white/5 transition-transform duration-500 ease-out"
          style={{ transform: `translate(${pos.x * -40}px, ${pos.y * -40}px)` }}
        />
        <div
          className="absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-white/5 transition-transform duration-500 ease-out"
          style={{ transform: `translate(${pos.x * 60}px, ${pos.y * 60}px)` }}
        />

        <div className="relative z-10 flex flex-col items-center gap-10 max-w-lg">
          <div style={{ perspective: 800 }}>
            <div
              className="relative transition-transform duration-200 ease-out"
              style={{ transform: `rotateY(${pos.x * 24}deg) rotateX(${-pos.y * 24}deg)` }}
            >
              <span className="absolute inset-0 rounded-full border-2 border-white/60" style={{ animation: "cPulse 2.8s ease-out infinite" }} />
              <span className="absolute inset-0 rounded-full border-2 border-white/40" style={{ animation: "cPulse 2.8s ease-out 1.4s infinite" }} />
              <div className="relative rounded-full bg-white p-3 shadow-[0_20px_60px_rgba(0,0,0,0.45)] ring-4 ring-white/30 hover:scale-105 transition-transform duration-300" style={{ animation: "cFloat 5s ease-in-out infinite" }}>
                <img src="/ncsc-logo.png" alt="National Commission of Senior Citizens" className="h-60 w-60" draggable={false} />
              </div>
            </div>
          </div>

          <div className="space-y-3" style={{ animation: "cRise .9s ease-out both" }}>
            <h1 className="text-6xl font-bold tracking-[0.2em] drop-shadow-lg">
              {"CARES".split("").map((c, i) => (
                <span key={i} className="inline-block transition-transform duration-200 hover:-translate-y-2 hover:text-red-200">{c}</span>
              ))}
            </h1>
            <p className="text-lg font-medium text-white/90">Centralized Administrative Resource Efficiency System</p>
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-center p-6 sm:p-12 overflow-hidden bg-gradient-to-br from-[#1e3a8a] via-[#1e3a8a] to-[#b91c1c] lg:bg-none lg:bg-background">

        <div className="relative w-full max-w-md animate-fade-in-up">
          <div className="absolute -top-14 left-1/2 -translate-x-1/2 z-10 rounded-full bg-white p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.3)] ring-4 ring-white/40 lg:hidden">
            <img src="/ncsc-logo.png" alt="NCSC" className="h-24 w-24" draggable={false} />
          </div>

          <Card className="relative w-full p-8 pt-12 lg:pt-8 shadow-elevated backdrop-blur border-white/20 lg:border-border/70">
            <div className="text-center lg:text-left mb-6">
              <div className="lg:hidden mb-4">
                <div className="text-2xl font-bold tracking-[0.25em] text-primary">CARES</div>
                <div className="text-[11px] text-muted-foreground">Centralized Administrative Resource Efficiency System</div>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
              <p className="text-sm text-muted-foreground">Sign in to access your dashboard.</p>
            </div>
            <SignInForm />
          </Card>
        </div>
      </div>
    </div>
  );
}

function SignInForm() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false); const [caps, setCaps] = useState(false); const [shake, setShake] = useState(0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { toast.error(error.message); setShake(n => n + 1); }
    else toast.success("Signed in");
  };
  return (
    <form onSubmit={submit} key={shake} className="space-y-5" style={shake ? { animation: "loginShake .4s" } : undefined}>
      <style>{`@keyframes loginShake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }`}</style>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <div className="group relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} className="h-11 pl-10 rounded-xl transition-shadow focus-visible:ring-2 focus-visible:ring-primary/40" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="group relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <Input id="password" type={show ? "text" : "password"} required autoComplete="current-password" placeholder="••••••••" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyUp={e => setCaps(e.getModifierState("CapsLock"))}
            className="h-11 pl-10 pr-11 rounded-xl transition-shadow focus-visible:ring-2 focus-visible:ring-primary/40" />
          <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {caps && <p className="text-xs text-amber-500 animate-fade-in-up">Caps Lock is on</p>}
      </div>
      <Button type="submit" disabled={busy} className="group h-11 w-full rounded-xl gradient-brand text-white text-base font-semibold shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 border-0">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {busy ? "Signing in…" : "Sign in"}
        {!busy && <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />}
      </Button>
    </form>
  );
}
