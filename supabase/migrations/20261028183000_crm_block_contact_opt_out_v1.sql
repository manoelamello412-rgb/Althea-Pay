-- Amplia o opt-out existente para reconhecer o botão "Bloquear Contato"
-- e pedidos explícitos para não receber novas mensagens.

create or replace function private.crm_consent_from_inbound_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_keyword text := regexp_replace(
    translate(
      upper(coalesce(new.body, '')),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'AAAAAEEEEIIIIOOOOOUUUUC'
    ),
    '[^A-Z]',
    '',
    'g'
  );
  v_status text;
  v_source text;
  v_address text;
begin
  v_status := case
    when v_keyword in (
      'SAIR',
      'PARAR',
      'STOP',
      'CANCELAR',
      'DESCADASTRAR',
      'BLOQUEARCONTATO',
      'NAOENTREEMCONTATO',
      'NAOENTREMAISEMCONTATO',
      'NAOMECHAME',
      'NAOMECHAMEMAIS',
      'NAOMEENVIEMENSAGENS',
      'NAOMEENVIEMAISMENSAGENS',
      'NAOMANDEMENSAGENS',
      'NAOMANDEMAISMENSAGENS',
      'REMOVAMEUNUMERO',
      'REMOVERMEUNUMERO',
      'EXCLUAMEUNUMERO',
      'PAREDEMECHAMAR',
      'NAOQUERORECEBERMENSAGENS',
      'NAOQUEROMAISMENSAGENS'
    ) then 'opted_out'
    when v_keyword in (
      'VOLTAR',
      'START',
      'DESBLOQUEARCONTATO',
      'QUEROVOLTARARECEBERMENSAGENS'
    ) then 'opted_in'
  end;

  if v_status is null then
    return new;
  end if;

  v_source := case
    when v_status = 'opted_out'
      then 'inbound_block_request'
    else 'inbound_resubscribe'
  end;

  select private.crm_consent_address(
    new.channel,
    coalesce(identity_row.phone_e164, identity_row.external_user_id)
  )
  into v_address
  from public.crm_channel_identities as identity_row
  where identity_row.conversation_id = new.conversation_id
    and identity_row.channel = new.channel
  order by identity_row.updated_at desc
  limit 1;

  if v_address is null then
    return new;
  end if;

  insert into public.crm_channel_consents (
    organization_id,
    channel,
    address,
    status,
    source,
    source_message_id
  )
  values (
    new.organization_id,
    new.channel,
    v_address,
    v_status,
    v_source,
    new.id
  )
  on conflict (organization_id, channel, address)
  do update set
    status = excluded.status,
    source = excluded.source,
    source_message_id = excluded.source_message_id,
    updated_at = now();

  return new;
end;
$function$;

revoke all
  on function private.crm_consent_from_inbound_message()
  from public, anon, authenticated;
