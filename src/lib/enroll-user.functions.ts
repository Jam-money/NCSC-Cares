import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(72),
  unit: z.enum(["SOCD", "CRASD"]),
  employmentType: z.enum(["regular", "cosw", "jo", "lgu", "gip"]),
  position: z.string().trim().max(120).optional(),
});

export const enrollUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRow } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!roleRow) throw new Error("Only admins can enroll users.");

    const email = data.email.toLowerCase();
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user.");

    // The signup trigger defaults new users to 'director'; enrolled users must be plain staff.
    const roles = (supabaseAdmin as any).from("user_roles");
    await roles.delete().eq("user_id", created.user.id);
    const { error: rErr } = await roles.insert({ user_id: created.user.id, role: "staff" });
    if (rErr) throw new Error(`User created, but setting the staff role failed: ${rErr.message}`);

    const { error: pErr } = await (supabaseAdmin as any).from("profiles").upsert({
      id: created.user.id,
      email,
      full_name: data.fullName,
      position: data.position || (data.employmentType === "cosw" ? "COSW" : data.employmentType === "jo" ? "Job Order" : data.employmentType === "lgu" ? "LGU" : data.employmentType === "gip" ? "GIP" : null),
      unit: data.unit,
      employment_type: data.employmentType,
    }, { onConflict: "id" });
    if (pErr) throw new Error(`User created, but profile update failed: ${pErr.message}`);

    return { id: created.user.id };
  });
