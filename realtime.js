(() => {
  let liveChannel = null;
  let refreshTimer = null;
  let starting = false;
  const tables = ['gateway_transactions','checkout_sessions','chats','messages','integration_events','webhook_deliveries'];

  async function startRealtimeCore() {
    if (!window.sb || !window.sb.channel || !window.user?.id || starting) return;
    starting = true;
    try {
      if (liveChannel) { try { await sb.removeChannel(liveChannel); } catch {} }
      liveChannel = sb.channel(`althea-core-${user.id}`);
      tables.forEach(table => liveChannel.on('postgres_changes',{event:'*',schema:'public',table},()=>{
        const state=document.getElementById('syncState');
        if(state) state.innerHTML='<i></i> Atualizado agora';
        clearTimeout(refreshTimer);
        refreshTimer=setTimeout(()=>{if(typeof go==='function'&&typeof active!=='undefined'&&document.getElementById('view'))go(active)},250);
      }));
      liveChannel.subscribe(status=>{
        const state=document.getElementById('syncState'); if(!state)return;
        if(status==='SUBSCRIBED')state.innerHTML='<i></i> LIVE';
        else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')state.innerHTML='<i></i> Reconectando…';
      });
    } finally { starting=false; }
  }

  window.startRealtimeCore=startRealtimeCore;
  if(window.sb?.auth) sb.auth.onAuthStateChange((_event,session)=>{
    if(session?.user)setTimeout(()=>startRealtimeCore().catch(()=>{}),0);
    else if(liveChannel){sb.removeChannel(liveChannel).catch(()=>{});liveChannel=null;}
  });
})();
