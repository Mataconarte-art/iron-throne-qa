// GET /api/health — liveness probe. No auth (safe to expose).
export function onRequestGet() {
  return new Response(
    JSON.stringify({
      status: "ok",
      phase: 0,
      service: "iron-throne-qa",
      time: new Date().toISOString(),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
