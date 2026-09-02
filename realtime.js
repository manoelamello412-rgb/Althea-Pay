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

  async function provisionSandboxGateway(funnelId=null) {
    if (!window.sb || !window.user?.id) return null;
    const result=await sb.functions.invoke('sandbox-provision',{body:funnelId?{funnel_id:funnelId}:{}});
    if(result.error) throw result.error;
    return result.data||null;
  }
  window.provisionSandboxGateway=provisionSandboxGateway;

  async function bootstrapSandbox() {
    try { await provisionSandboxGateway(null); } catch (e) { console.warn('Sandbox bootstrap skipped',e?.message||e); }
  }

  window.newGateway = function() {
    modal('Adicionar gateway',`<form id="gatewayForm">
      <div class="field"><label>Nome</label><input id="gn" required value="ALTHEA Sandbox"></div>
      <div class="field"><label>Provedor</label><input id="gp" value="sandbox"></div>
      <div class="field"><label>Ambiente</label><select id="ge"><option>sandbox</option><option>production</option></select></div>
      <button class="primary">Salvar gateway</button>
    </form>`);
    gatewayForm.onsubmit=async e=>{
      e.preventDefault();
      try {
        if (ge.value==='sandbox') {
          await provisionSandboxGateway(null);
        } else {
          const r=await sb.from('gateways').insert({
            id:crypto.randomUUID(),
            user_id:user.id,
            data:{name:gn.value.trim(),provider:gp.value.trim()||'custom',environment:'production',status:'not_configured'}
          });
          if(r.error) throw r.error;
        }
        closeModal(); go('gateways');
      } catch(err) { alert(err.message||'Não foi possível salvar o gateway.'); }
    };
  };

  window.newFunnel = function() {
    modal('Conectar novo funil',`<form id="funnelForm">
      <div class="field"><label>Nome do funil</label><input id="fn" required></div>
      <div class="field"><label>URL</label><input id="fu" type="url" placeholder="https://..."></div>
      <div class="field"><label>Conexão</label><select id="ft"><option>script / SDK</option><option>webhook</option><option>API</option><option>GitHub</option><option>Vercel</option><option>WordPress</option></select></div>
      <div class="field"><label>Endpoint ou referência</label><input id="fe"></div>
      <button class="primary">Conectar</button>
    </form>`);
    funnelForm.onsubmit=async e=>{
      e.preventDefault();
      const id=crypto.randomUUID();
      try {
        const r=await sb.from('funnels').insert({id,user_id:user.id,nome:fn.value.trim(),url:fu.value.trim()||null,endpoint:fe.value.trim()||null,status:'active'});
        if(r.error) throw r.error;
        const c=await sb.from('funnel_connections').upsert({user_id:user.id,funnel_id:id,status:'connected',connection_type:ft.value});
        if(c.error) throw c.error;
        await provisionSandboxGateway(id);
        closeModal(); go('funnels');
      } catch(err) { alert(err.message||'Não foi possível conectar o funil.'); }
    };
  };

  window.sandboxTransaction = async function(scenario='approved') {
    if (!window.user?.id) return alert('Faça login para testar o Sandbox.');
    try {
      await provisionSandboxGateway(null);
      const f=await sb.from('funnels').select('id,nome').eq('user_id',user.id).is('deleted_at',null).limit(1).maybeSingle();
      if(f.error) throw f.error;
      if(!f.data) return alert('Conecte um funil antes de testar o Sandbox.');
      const p=await sb.from('products').select('id,data').eq('user_id',user.id).limit(1).maybeSingle();
      if(p.error) throw p.error;
      const amount=Number(p.data?.data?.price||p.data?.data?.amount||10);
      const metadata={sandbox:true,source:'control_center'};
      if(scenario==='technical') metadata.simulate_failure='technical';
      if(scenario==='card_decline') metadata.simulate_failure='card_decline';
      const body={
        funnel_id:f.data.id,
        product_id:p.data?.id||null,
        amount,
        currency:'BRL',
        operation:'create_payment',
        idempotency_key:`ui_sbx_${crypto.randomUUID()}`,
        customer:{name:'Cliente Sandbox',email:'sandbox@althea.local'},
        metadata
      };
      const result=await sb.functions.invoke('gateway-orchestrator',{body});
      if(result.error) throw result.error;
      closeModal();
      go('transactions');
      return result.data;
    } catch(err) {
      alert(err.message||'Falha no Sandbox.');
    }
  };

  window.openSandboxTest = function() {
    modal('Teste operacional do Sandbox',`<p class="muted">Nenhum dinheiro real é movimentado. O teste usa o mesmo Orchestrator, idempotência e roteamento da operação.</p>
      <div class="field"><label>Cenário</label><select id="sandboxScenario">
        <option value="approved">Aprovada</option>
        <option value="technical">Falha técnica — deve permitir fallback</option>
        <option value="card_decline">Recusa do cartão — não deve fazer fallback</option>
      </select></div>
      <button class="primary" id="runSandbox">Executar teste</button>`);
    runSandbox.onclick=()=>sandboxTransaction(sandboxScenario.value);
  };

  if(window.sb?.auth) sb.auth.onAuthStateChange((_event,session)=>{
    if(session?.user) setTimeout(()=>bootstrapSandbox(),250);
  });

  // Checkout UI now uses the deployed Checkout Engine instead of writing sessions directly from the browser.
  window.newCheckout = async function() {
    const f=await sb.from('funnels').select('id,nome').eq('user_id',user.id).is('deleted_at',null).order('created_at',{ascending:false});
    if(f.error) return alert(f.error.message);
    const p=await sb.from('products').select('id,data').eq('user_id',user.id).order('created_at',{ascending:false});
    if(p.error) return alert(p.error.message);
    if(!(f.data||[]).length) return alert('Conecte um funil antes de criar um checkout.');
    modal('Nova sessão de checkout',`<form id="checkoutForm">
      <div class="field"><label>Funil</label><select id="cf">${(f.data||[]).map(x=>`<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></div>
      <div class="field"><label>Produto</label><select id="cp"><option value="">Sem produto</option>${(p.data||[]).map(x=>{const d=x.data||{};return `<option value="${x.id}" data-price="${d.price||d.amount||0}">${esc(d.name||d.nome||'Produto')}</option>`}).join('')}</select></div>
      <div class="field"><label>Valor</label><input id="ca" type="number" min="0.01" step="0.01" value="10"></div>
      <div class="field"><label>Cliente</label><input id="cn" placeholder="Nome"></div>
      <div class="field"><label>E-mail</label><input id="ce" type="email" placeholder="cliente@email.com"></div>
      <div class="field"><label>UTM campaign</label><input id="uc"></div>
      <button class="primary">Criar sessão</button>
    </form>`);
    cp.onchange=()=>{const v=Number(cp.options[cp.selectedIndex]?.dataset.price||0);if(v>0)ca.value=v;};
    checkoutForm.onsubmit=async e=>{
      e.preventDefault();
      const ik=`ui_chk_${crypto.randomUUID()}`;
      const body={
        funnel_id:cf.value,
        product_id:cp.value||null,
        amount:Number(ca.value||0),
        currency:'BRL',
        action:'start',
        idempotency_key:ik,
        customer:{name:cn.value.trim(),email:ce.value.trim()},
        attribution:{utm_campaign:uc.value.trim()},
        metadata:{source:'control_center'}
      };
      try {
        const result=await sb.functions.invoke('checkout-engine-v2',{body,headers:{'x-idempotency-key':ik}});
        if(result.error) throw result.error;
        closeModal(); go('checkout');
      } catch(err) { alert(err.message||'Não foi possível criar o checkout.'); }
    };
  };
})();
