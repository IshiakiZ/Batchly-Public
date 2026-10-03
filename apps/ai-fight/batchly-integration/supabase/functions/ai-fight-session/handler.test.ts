import { createAiFightSessionHandler } from "./handler.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const token = "test-only-" + "placeholder-not-a-real-jwt";
function assert(value: unknown): asserts value { if (!value) throw new Error("assertion failed"); }
const makeRequest = (body: unknown, headers = {}) => new Request("https://test.invalid", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token, ...headers }, body: JSON.stringify(body) });
Deno.test("verified JWT identity is the only forwarded actor", async () => {
  let input: Record<string, unknown> = {};
  const handler = createAiFightSessionHandler({ getUser: async jwt => jwt === token ? { id: actor } : null, db: { rpc: async (_name, args) => { input = args; return { data: { ok: true, session: { id: actor } }, error: null }; } } });
  const response = await handler(makeRequest({ action: "get", args: { session_id: actor } }));
  assert(response.status === 200 && (await response.json()).ok && input.p_actor === actor && input.p_token_id === null);
  const extra = await handler(makeRequest({ action: "get", args: { session_id: actor }, actorId: actor })); assert(extra.status === 400);
});
Deno.test("unauthenticated, invalid origin, bad method and oversized bodies are refused", async () => {
  let calls = 0;
  const handler = createAiFightSessionHandler({ getUser: async jwt => jwt === token ? { id: actor } : null, db: { rpc: async () => { calls++; return { data: { ok: true }, error: null }; } } });
  assert((await handler(makeRequest({}, { authorization: "" }))).status === 401);
  assert((await handler(makeRequest({}, { origin: "https://foreign.invalid" }))).status === 403);
  assert((await handler(new Request("https://test.invalid"))).status === 405);
  assert((await handler(makeRequest({ source: "x".repeat(190000) }))).status === 413);
  assert(calls === 0);
});
