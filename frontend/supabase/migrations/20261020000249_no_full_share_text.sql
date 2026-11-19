-- A whole owner is not written "(100%)": only a part share is shown (for example "(50%)").
do $$
declare
  d text := pg_get_functiondef('public.document_changes(uuid)'::regprocedure);
  a text := 'coalesce('' ('' || trim_scale((o ->> ''share_pct'')::numeric)::text || ''%)'', '''')';
  b text := 'case when (o ->> ''share_pct'')::numeric < 100 then '' ('' || trim_scale((o ->> ''share_pct'')::numeric)::text || ''%)'' else '''' end';
begin
  if position(a in d) = 0 then
    raise exception 'document_changes: anchor not found';
  end if;
  execute replace(d, a, b);
end $$;
