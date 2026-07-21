import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { isAuthorized, validateEvent } from "../_shared/shortcut-core.mjs";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const shortcutSecret = Deno.env.get("SHORTCUT_SECRET") || "";
  const ownerUserId = Deno.env.get("OWNER_USER_ID") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!shortcutSecret || !ownerUserId || !supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, error: "server_not_configured" });
  }

  if (!isAuthorized(request.headers.get("x-shortcut-secret"), shortcutSecret)) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 4096) return json(400, { ok: false, error: "invalid_body" });

  let event;
  try {
    event = validateEvent(JSON.parse(rawBody));
  } catch (error) {
    return json(400, { ok: false, error: error instanceof Error ? error.message : "invalid_event" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await admin.rpc("apply_shortcut_event", {
    target_user_id: ownerUserId,
    target_event_id: event.event_id,
    event_type: event.type,
    event_value: event.value,
    event_date: event.occurred_on
  });

  if (error) {
    console.error("shortcut_ingest_failed", error.code || "database_error");
    return json(500, { ok: false, error: "write_failed" });
  }

  const result = Array.isArray(data) ? data[0] : data;
  return json(200, {
    ok: true,
    applied: Boolean(result?.applied),
    version: Number(result?.saved_version || 0)
  });
});
