(() => {
  let liveChannel = null;
  let refreshTimer = null;
  const tables = ['gateway_transactions','checkout_sessions','chats','messages','integration_events','webhook_deliveries'];

  async function startRealtimeCore() {
    if (liveChannel) { try { await sb.removeChannel(liveChannel); } catch {} }
    const channelName = `althea-core-${user?.id || 'session'}`;
    liveChannel = sb.channel(channelName);
    tables.forEach(table => {
      liveChannel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
        const state = document.getElementById('syncState');
        if (state) state.innerHTML = '<i></i> Atualizado agora';
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { if (typeof go === 'function') go(active); }, 250);
      });
    });
    liveChannel.subscribe(status => {
      const state = document.getElementById('syncState');
      if (!state) return;
      if (status === 'SUBSCRIBED') state.innerHTML = '<i></i> LIVE';
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') state.innerHTML = '<i></i> Reconectando…';
    });
  }
  window.startRealtimeCore = startRealtimeCore;
  const oldStartLive = window.startLive;
  window.startLive = function() {
    if (typeof oldStartLive === 'function') oldStartLive();
    startRealtimeCore().catch(() => {});
  };
})();
