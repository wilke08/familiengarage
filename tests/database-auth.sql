-- Als postgres nach schema.sql ausführen. Alle Teständerungen werden zurückgerollt.
-- Es wird ein eigenes Testpasswort verwendet; das echte Passwort bleibt erhalten.
begin;
select private.set_family_password('example-integration-test-password');

do $$
declare result jsonb;
begin
  for attempt in 1..5 loop
    result := public.family_login('incorrect-integration-test-password');
    if attempt < 5 and result->>'error' is distinct from 'invalid_password' then
      raise exception 'Fehlversuche wurden nicht korrekt erkannt';
    end if;
  end loop;
  if result->>'error' is distinct from 'locked' then
    raise exception 'Sperre fehlt nach fünf Fehlversuchen';
  end if;
  result := public.family_login('example-integration-test-password');
  if result->>'error' is distinct from 'locked' then
    raise exception 'Sperre wurde mit korrektem Passwort umgangen';
  end if;
end;
$$;

update private.family_access set locked_until = now() - interval '1 second',
  attempt_window_started = now() - interval '16 minutes' where singleton;
do $$
declare result jsonb;
begin
  result := public.family_login('example-integration-test-password');
  if result->>'session_token' is null or length(result->>'session_token') <> 64 then
    raise exception 'Gültiges Passwort erzeugt keine Sitzung';
  end if;
  perform set_config('familiengarage.test_token', result->>'session_token', true);
end;
$$;

set local role anon;
do $$
declare
  saved public.reservations;
  second_saved public.reservations;
  session_token text := current_setting('familiengarage.test_token');
begin
  if has_table_privilege(current_user, 'public.reservations', 'select')
    or has_table_privilege(current_user, 'public.reservations', 'insert')
    or has_table_privilege(current_user, 'public.reservations', 'delete') then
    raise exception 'Direkter Tabellenzugriff ist öffentlich';
  end if;
  begin
    perform public.family_list_reservations(repeat('0', 64));
    raise exception 'Lesen ohne Sitzung ist möglich';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.family_create_reservation(repeat('0',64), 'BMW 320d', 'Wilke',
      '2199-11-02 08:00+01', '2199-11-02 09:00+01', false, 'Test');
    raise exception 'Anlegen ohne Sitzung ist möglich';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.family_delete_reservation(repeat('0',64), '00000000-0000-0000-0000-000000000000');
    raise exception 'Löschen ohne Sitzung ist möglich';
  exception when insufficient_privilege then null;
  end;

  saved := public.family_create_reservation(session_token, 'BMW 320d', 'Wilke',
    '2199-11-02 08:00+01', '2199-11-02 09:00+01', false, 'Nur ein zurückgerollter Integrationstest');
  if not exists (select 1 from public.family_list_reservations(session_token) where id = saved.id) then
    raise exception 'Gespeicherte Reservierung ist nicht lesbar';
  end if;
  begin
    perform public.family_create_reservation(session_token, 'BMW 320d', 'Anja',
      '2199-11-02 08:30+01', '2199-11-02 09:30+01', false, 'Konflikttest');
    raise exception 'Doppelbuchung wurde zugelassen';
  exception when exclusion_violation then null;
  end;
  second_saved := public.family_create_reservation(session_token, 'BMW 320d', 'Anja',
    '2199-11-02 09:00+01', '2199-11-02 10:00+01', false, 'Direkt anschließende Buchung');
  if not public.family_delete_reservation(session_token, saved.id)
    or not public.family_delete_reservation(session_token, second_saved.id) then
    raise exception 'Berechtigtes Löschen fehlgeschlagen';
  end if;
  perform public.family_logout(session_token);
  begin
    perform public.family_list_reservations(session_token);
    raise exception 'Sitzung ist nach Abmeldung weiterhin gültig';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select 'Passwort, Sperre, Zugriffsrechte, CRUD, Konflikte und Abmeldung: erfolgreich' as result;
rollback;
