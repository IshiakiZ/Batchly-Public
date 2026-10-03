import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createAiFightSessionHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createAiFightSessionHandler({
  db: admin,
  getUser: async jwt => {
    const { data, error } = await auth.auth.getUser(jwt);
    return error || !data.user ? null : { id: data.user.id };
  },
}));
