import { AI_FIGHT_TOOLS, runAiFightTool, runAiFightBrowser, validateAiFightArgs } from "./tools.ts";
const id = "10000000-0000-4000-8000-000000000001";
const token = ["10000000", "0000", "4000", "8000", "000000000002"].join("-");
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
Deno.test("four additive tools reject extra top-level arguments", () => {
  assert(AI_FIGHT_TOOLS.length === 4);
  for (const tool of AI_FIGHT_TOOLS) assert(tool.inputSchema.additionalProperties === false);
  for (const args of [{ session_id: id, actorId: id }, { session_id: id, tokenId: token }, { session_id: id, owner_id: id }]) {
    let rejected = false; try { validateAiFightArgs("get", args); } catch { rejected = true; } assert(rejected);
  }
});
Deno.test("filenames, byte limits and revisions are enforced", () => {
  const base = { session_id: id, side: 0, expected_revision: 0 };
  for (const files of [{ "../brain.js": "x", "fighter.json": "{}" }, { "brain.js": 3, "fighter.json": "{}" }, { "brain.js": "é".repeat(40000), "fighter.json": "{}" }]) {
    let rejected = false; try { validateAiFightArgs("submit", { ...base, files }); } catch { rejected = true; } assert(rejected);
  }
  for (const side of [-1, 2, "0", null]) { let rejected = false; try { validateAiFightArgs("ready", { ...base, side }); } catch { rejected = true; } assert(rejected); }
  for (const expected_revision of [-1, 1.5, "1", null]) { let rejected = false; try { validateAiFightArgs("ready", { ...base, expected_revision }); } catch { rejected = true; } assert(rejected); }
});
Deno.test("identity comes from authenticated context and the browser never forwards a token", async () => {
  const calls: Record<string, unknown>[] = [];
  const db = { rpc: async (_name: string, args: Record<string, unknown>) => { calls.push(args); return { data: { ok: true, session: { id } }, error: null }; } };
  const result = await runAiFightTool("ai_fight_get_session", { session_id: id }, { db, actorId: id, tokenId: token });
  assert(!result.isError && calls[0].p_actor === id && calls[0].p_token_id === token);
  await runAiFightBrowser("get", { session_id: id }, { db, actorId: id }); assert(calls[1].p_token_id === null);
  await runAiFightBrowser("submit", {}, { db, actorId: id }); assert(calls.length === 2);
});
Deno.test("database errors never disclose diagnostics and malformed requests never call RPC", async () => {
  let called = 0;
  const db = { rpc: async () => { called++; return { data: null, error: { message: "private database detail" } }; } };
  const bad = await runAiFightTool("ai_fight_get_session", { session_id: id, owner: id }, { db, actorId: id, tokenId: token });
  assert(bad.isError && called === 0);
  const result = await runAiFightTool("ai_fight_get_session", { session_id: id }, { db, actorId: id, tokenId: token });
  assert(result.isError && !JSON.stringify(result).includes("private database detail"));
  const thrown = await runAiFightTool("ai_fight_get_session", { session_id: id }, { actorId: id, tokenId: token, db: { rpc: async () => { throw new Error("private transport detail"); } } });
  assert(thrown.isError && !JSON.stringify(thrown).includes("private transport detail"));
});
