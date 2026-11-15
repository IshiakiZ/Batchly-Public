// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Supabase Edge Function entry (Deno). The deploy step copies proxy/src/*.js (without the
// *.test.js files) into ./src next to this file; see README.md. All logic lives in ./src.

import { createHandler } from "./src/handler.js";
import { createMemoryCache, createSupabaseCache } from "./src/cache.js";
// Imported here, not only lazily inside the handler, so the bundle always contains them.
import * as fits from "./src/fits.js";
import * as encode from "./src/encode.js";
import * as fog from "./src/fog.js";
import * as expindex from "./src/expindex.js";
import * as s3cutout from "./src/s3cutout.js";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Without the two variables the function still works, with a small per-isolate memory cache
// (edge isolates have 256 MB, so the cap is far below the default).
const cache = supabaseUrl && serviceKey
  ? createSupabaseCache({ url: supabaseUrl, serviceKey, bucket: "spherex-cache" })
  : createMemoryCache({ maxBytes: 48 * 1024 * 1024 });

if (!(supabaseUrl && serviceKey)) {
  console.warn("[tombaugh] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: using a memory cache");
}

Deno.serve(createHandler({
  fetchImpl: fetch,
  cache,
  // "s3": NASA's public copy of the SPHEREx files on AWS Open Data, searched through our own
  // exposure index and cut out with Range requests; IRSA is only the fallback.
  backend: "s3",
  version: "0.2.0",
  deps: { fits, encode, fog, expindex, s3cutout },
}));
