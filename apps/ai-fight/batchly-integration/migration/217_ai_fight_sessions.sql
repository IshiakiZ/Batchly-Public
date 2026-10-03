-- Additive AI Fight mailbox. No submitted source is executed by PostgreSQL or an Edge Function.
-- Apply only after review. The feature is disabled until separately enabled by the owner.
begin;

create table public.ai_fight_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('fighter','army','war','business')),
  round integer not null default 1 check (round between 1 and 12),
  revision integer not null default 0 check (revision >= 0),
  phase text not null default 'building' check (phase in ('building','ready','round_over','complete')),
  builds jsonb not null default '[null,null]' check (jsonb_typeof(builds) = 'array' and jsonb_array_length(builds) = 2 and octet_length(builds::text) <= 140000),
  ready boolean[] not null default array[false,false] check (array_length(ready,1) = 2),
  side_tokens uuid[] not null default array[null::uuid,null::uuid] check (array_length(side_tokens,1) = 2),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 18000)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index ai_fight_sessions_owner_expiry on public.ai_fight_sessions(owner_id, expires_at);
create table public.ai_fight_limits (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  minute_start timestamptz not null default now(),
  calls integer not null default 0,
  writes integer not null default 0,
  day_start timestamptz not null default now(),
  creates integer not null default 0
);
alter table public.ai_fight_sessions enable row level security;
alter table public.ai_fight_limits enable row level security;
revoke all on public.ai_fight_sessions, public.ai_fight_limits from public, anon, authenticated;
-- No client policies: all access passes through the service-only actor-checked RPC.
grant all on public.ai_fight_sessions, public.ai_fight_limits to service_role;
insert into public.feature_flags(key, enabled) values ('ai_fight_enabled', false) on conflict (key) do nothing;

create function public.ai_fight_dispatch_as(p_actor uuid, p_token_id uuid, p_action text, p_args jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.ai_fight_sessions%rowtype;
  limits public.ai_fight_limits%rowtype;
  expected_keys text[];
  session_id uuid;
  side integer;
  expected_revision integer;
  source_files jsonb;
  file_name text;
  file_value jsonb;
  design_name text;
  brain_name text;
  visible_builds jsonb;
begin
  if not public.bl_is_trusted_caller() then raise exception 'service_role_only'; end if;
  if p_actor is null or not public.mcp_account_eligible(p_actor) then return jsonb_build_object('ok',false,'error','Account is not eligible.'); end if;
  if not coalesce((select enabled from public.feature_flags where key='ai_fight_enabled'),false) then return jsonb_build_object('ok',false,'error','AI Fight account sessions are turned off.'); end if;
  if p_token_id is not null then
    if not coalesce((select enabled from public.feature_flags where key='mcp_enabled'),false)
      or not exists (select 1 from public.mcp_tokens t where t.id=p_token_id and t.user_id=p_actor and t.revoked_at is null and t.expires_at>now() and t.scopes=array['upload']::text[]) then
      return jsonb_build_object('ok',false,'error','Creator token is unavailable.');
    end if;
    if p_action not in ('create','get','submit','ready') then return jsonb_build_object('ok',false,'error','Action is not available to a creator token.'); end if;
  elsif p_action not in ('get','complete','next') then
    return jsonb_build_object('ok',false,'error','Action is not available to the browser host.');
  end if;
  expected_keys := case p_action when 'create' then array['mode'] when 'get' then array['session_id'] when 'submit' then array['session_id','side','expected_revision','files'] when 'ready' then array['session_id','side','expected_revision'] when 'complete' then array['session_id','expected_revision','result'] when 'next' then array['session_id','expected_revision'] end;
  if expected_keys is null or p_args is null or jsonb_typeof(p_args)<>'object' then return jsonb_build_object('ok',false,'error','Invalid arguments.'); end if;
  if (select count(*) from jsonb_object_keys(p_args)) <> cardinality(expected_keys) or not p_args ?& expected_keys then return jsonb_build_object('ok',false,'error','Missing or unexpected arguments.'); end if;
  if p_action='create' then
    if jsonb_typeof(p_args->'mode')<>'string' or p_args->>'mode' not in ('fighter','army','war','business') then return jsonb_build_object('ok',false,'error','Invalid mode.'); end if;
  else
    if jsonb_typeof(p_args->'session_id')<>'string' or coalesce(p_args->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok',false,'error','Invalid session ID.'); end if;
    session_id := (p_args->>'session_id')::uuid;
  end if;
  if p_action not in ('create','get') then
    if jsonb_typeof(p_args->'expected_revision')<>'number' or coalesce(p_args->>'expected_revision','') !~ '^[0-9]{1,10}$' or (p_args->>'expected_revision')::bigint > 2147483646 then return jsonb_build_object('ok',false,'error','Invalid revision.'); end if;
    expected_revision := (p_args->>'expected_revision')::integer;
  end if;
  if p_action in ('submit','ready') then
    if p_args->'side' not in ('0'::jsonb,'1'::jsonb) then return jsonb_build_object('ok',false,'error','Invalid side.'); end if;
    side := (p_args->>'side')::integer + 1;
  end if;
  -- One row lock serializes quotas and all mutations for this account, across isolates.
  insert into public.ai_fight_limits(owner_id) values (p_actor) on conflict do nothing;
  select * into limits from public.ai_fight_limits where owner_id=p_actor for update;
  if limits.minute_start <= now()-interval '1 minute' then limits.minute_start:=now(); limits.calls:=0; limits.writes:=0; end if;
  if limits.day_start <= now()-interval '24 hours' then limits.day_start:=now(); limits.creates:=0; end if;
  if limits.calls>=60 or (p_action<>'get' and limits.writes>=30) then return jsonb_build_object('ok',false,'error','Rate limit reached. Retry after one minute.'); end if;
  limits.calls:=limits.calls+1;
  if p_action<>'get' then limits.writes:=limits.writes+1; end if;
  update public.ai_fight_limits set minute_start=limits.minute_start,calls=limits.calls,writes=limits.writes,day_start=limits.day_start,creates=limits.creates where owner_id=p_actor;
  if p_action='create' then
    if limits.creates>=10 or (select count(*) from public.ai_fight_sessions where owner_id=p_actor and expires_at>now())>=3 or (select count(*) from public.ai_fight_sessions where owner_id=p_actor)>=100 then return jsonb_build_object('ok',false,'error','Session limit reached: 3 active, 10 created per day, or 100 stored.'); end if;
    insert into public.ai_fight_sessions(owner_id,mode) values(p_actor,p_args->>'mode') returning * into s;
    update public.ai_fight_limits set creates=creates+1 where owner_id=p_actor;
  else
    select * into s from public.ai_fight_sessions where id=session_id and owner_id=p_actor and expires_at>now() for update;
    if not found then return jsonb_build_object('ok',false,'error','Session is unavailable.'); end if;
    if p_action<>'get' and expected_revision<>s.revision then return jsonb_build_object('ok',false,'error','Stale revision. Read the session and retry.'); end if;
    if p_action='submit' then
      if s.phase<>'building' or s.ready[side] then return jsonb_build_object('ok',false,'error','This build is locked for the round.'); end if;
      if (s.side_tokens[side] is not null and s.side_tokens[side]<>p_token_id) or s.side_tokens[3-side]=p_token_id then return jsonb_build_object('ok',false,'error','Side belongs to a different token, or this token already owns the other side.'); end if;
      source_files:=p_args->'files';
      if jsonb_typeof(source_files)<>'object' then return jsonb_build_object('ok',false,'error','Invalid files.'); end if;
      if (select count(*) from jsonb_object_keys(source_files)) not between 2 and 24 or octet_length(source_files::text)>65536 then return jsonb_build_object('ok',false,'error','Build exceeds file or byte limits.'); end if;
      design_name:=case s.mode when 'fighter' then 'fighter.json' when 'army' then 'army.json' when 'war' then 'forces.json' else 'company.json' end;
      brain_name:=case s.mode when 'fighter' then 'brain.js' when 'business' then 'strategy.js' else 'commander.js' end;
      if not source_files ?& array[design_name,brain_name] then return jsonb_build_object('ok',false,'error','Mode design and brain files are required.'); end if;
      for file_name,file_value in select key,value from jsonb_each(source_files) loop
        if jsonb_typeof(file_value)<>'string' or not (file_name in (design_name,brain_name,'notes.md') or (s.mode='fighter' and file_name='sprite.json') or file_name ~ '^lib/[a-zA-Z0-9_-]{1,64}\.js$') then return jsonb_build_object('ok',false,'error','Invalid source filename or type.'); end if;
      end loop;
      s.builds:=jsonb_set(s.builds,array[(side-1)::text],source_files); s.side_tokens[side]:=p_token_id;
    elsif p_action='ready' then
      if s.phase<>'building' or s.side_tokens[side] is distinct from p_token_id or s.builds->(side-1)='null'::jsonb then return jsonb_build_object('ok',false,'error','Submit your own build before ready.'); end if;
      s.ready[side]:=true;
      if s.ready[1] and s.ready[2] then s.phase:='ready'; end if;
    elsif p_action='complete' then
      if s.phase<>'ready' then return jsonb_build_object('ok',false,'error','Both sides must be ready first.'); end if;
      if jsonb_typeof(p_args->'result')<>'object' or octet_length((p_args->'result')::text)>16384 then return jsonb_build_object('ok',false,'error','Invalid result or result too large.'); end if;
      s.result := (p_args->'result') || jsonb_build_object('unranked',true,'source','host-browser');
      if p_args->'result'->'validation_failed'='true'::jsonb then
        s.phase:='building'; s.ready:=array[false,false];
      else
        s.phase:=case when s.round=12 then 'complete' else 'round_over' end;
      end if;
    elsif p_action='next' then
      if s.phase<>'round_over' or s.round>=12 then return jsonb_build_object('ok',false,'error','Finish this round before advancing.'); end if;
      s.round:=s.round+1; s.phase:='building'; s.ready:=array[false,false]; s.result:=null;
    end if;
    if p_action<>'get' then
      s.revision:=s.revision+1;
      update public.ai_fight_sessions set round=s.round,revision=s.revision,phase=s.phase,builds=s.builds,ready=s.ready,side_tokens=s.side_tokens,result=s.result where id=s.id;
    end if;
  end if;
  visible_builds := jsonb_build_array(
    case when p_token_id is null or s.side_tokens[1]=p_token_id then s.builds->0 else 'null'::jsonb end,
    case when p_token_id is null or s.side_tokens[2]=p_token_id then s.builds->1 else 'null'::jsonb end);
  return jsonb_build_object('ok',true,'session',jsonb_build_object(
    'id',s.id,'mode',s.mode,'round',s.round,'revision',s.revision,'phase',s.phase,
    'builds',visible_builds,'ready',to_jsonb(s.ready),'claimed',jsonb_build_array(s.side_tokens[1] is not null,s.side_tokens[2] is not null),
    'result',s.result,'expires_at',s.expires_at,
    'host_url','https://batch-ly.com/play/ai-fight?session='||s.id::text,
    'guide_url','https://batch-ly.com/ext/ai-fight-r1/guides/'||case s.mode when 'fighter' then 'AI_GUIDE.md' when 'army' then 'ARMY_GUIDE.md' when 'war' then 'WAR_GUIDE.md' else 'BUSINESS_GUIDE.md' end));
end $$;
revoke all on function public.ai_fight_dispatch_as(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.ai_fight_dispatch_as(uuid,uuid,text,jsonb) to service_role;
commit;
