// Server-side auth gate (critique 5). A client-side password is theater — the
// book text would still be reachable. The Function must verify a token BEFORE
// any retrieval or answer, and book text must live server-side only.
//
// Phase 0: permissive stub. If AUTH_TOKEN is set (env / .dev.vars), we enforce
// a Bearer match; if it's unset we allow through so the scaffold runs out of
// the box. Phase 5 tightens this (session cookies, rate limiting).

export function requireAuth(request, env) {
  const expected = env && env.AUTH_TOKEN;

  // No token configured yet → allow (scaffold convenience only).
  if (!expected) return { ok: true, stub: true };

  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return { ok: false, reason: "missing bearer token" };
  if (token !== expected) return { ok: false, reason: "invalid token" };
  return { ok: true };
}
