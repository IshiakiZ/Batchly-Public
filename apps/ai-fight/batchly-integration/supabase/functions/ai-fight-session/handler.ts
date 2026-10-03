import { runAiFightBrowser, type AiFightDb } from "../mcp/ai-fight/tools.ts";

const ORIGINS = new Set(["https://batch-ly.com", "https://www.batch-ly.com"]);
const MAX_BODY = 180 * 1024;
export interface SessionDependencies {
  db: AiFightDb;
  getUser: (jwt: string) => Promise<{ id: string } | null>;
}
export function createAiFightSessionHandler(dependencies: SessionDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    };
    if (origin && ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
    const respond = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !ORIGINS.has(origin)) return respond(403, { ok: false, error: "Origin is not allowed." });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return respond(405, { ok: false, error: "POST is required." });
    const authorization = request.headers.get("authorization") || "";
    const match = /^Bearer ([^\s]{20,8192})$/i.exec(authorization);
    if (!match) return respond(401, { ok: false, error: "Sign in to Batchly to host this session." });
    let actor: { id: string } | null;
    try { actor = await dependencies.getUser(match[1]); }
    catch { return respond(401, { ok: false, error: "Session authentication failed." }); }
    if (!actor) return respond(401, { ok: false, error: "Session authentication failed." });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return respond(415, { ok: false, error: "JSON is required." });
    if (Number(request.headers.get("content-length")) > MAX_BODY) return respond(413, { ok: false, error: "Request is too large." });
    let text = "";
    try {
      const reader = request.body?.getReader();
      if (!reader) return respond(400, { ok: false, error: "Request body is required." });
      const decoder = new TextDecoder();
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BODY) { await reader.cancel(); return respond(413, { ok: false, error: "Request is too large." }); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      const body = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2 || typeof body.action !== "string" || !Object.hasOwn(body, "args")) return respond(400, { ok: false, error: "Expected action and args only." });
      // getUser is the identity boundary. Actor and token are never accepted from JSON.
      return respond(200, await runAiFightBrowser(body.action, body.args, { db: dependencies.db, actorId: actor.id }));
    } catch { return respond(400, { ok: false, error: "Invalid JSON request." }); }
  };
}
