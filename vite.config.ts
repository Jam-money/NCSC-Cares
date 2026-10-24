import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config/dist/index.js";
import { nitro } from "nitro/vite";

// Expose server-only secrets (e.g. SUPABASE_SERVICE_ROLE_KEY) to server functions in local dev.
// Reads .env / .env.local and .dev.vars (all git-ignored except .env) into process.env.
for (const [k, v] of Object.entries(loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), ""))) {
  if (!(k in process.env)) process.env[k] = v;
}
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export default defineConfig({
  cloudflare: false,
  plugins: [nitro()],
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    publicDir: "public",
  },
});
