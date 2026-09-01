async function deleteFunnel(id){
  const r=await sb.from('funnels').select('id,nome,name').eq('id',id).eq('user_id',user.id).is('deleted_at',null).single();
  const name=r.data?.nome||r.data?.name||'';
  if(!name)return alert('Funil não encontrado.');
  const typed=prompt(`Digite exatamente "${name}" para enviar o funil para a lixeira:`);
  if(typed!==name)return;
  const d=await sb.from('funnels').update({deleted_at:new Date().toISOString(),deleted_by:user.id,status:'deleted'}).eq('id',id).eq('user_id',user.id).is('deleted_at',null);
  if(d.error)alert(d.error.message);else go('funnels');
}
async function restoreFunnel(id){
  const d=await sb.from('funnels').update({deleted_at:null,deleted_by:null,status:'active'}).eq('id',id).eq('user_id',user.id);
  if(d.error)alert(d.error.message);else go('funnels');
}
async function permanentlyDeleteFunnel(id){
  const r=await sb.from('funnels').select('id,nome,name').eq('id',id).eq('user_id',user.id).eq('deleted_at',null).maybeSingle();
  if(r.data)return alert('Primeiro envie o funil para a lixeira.');
  if(!confirm('Excluir permanentemente este funil do ALTHEA? Esta ação não pode ser desfeita.'))return;
  const d=await sb.from('funnels').delete().eq('id',id).eq('user_id',user.id);
  if(d.error)alert(d.error.message);else go('funnels');
}
async function funnels(v){
  const [activeR,trashR]=await Promise.all([
    sb.from('funnels').select('*').eq('user_id',user.id).is('deleted_at',null).order('created_at',{ascending:false}),
    sb.from('funnels').select('*').eq('user_id',user.id).not('deleted_at','is',null).order('deleted_at',{ascending:false})
  ]);
  const rows=activeR.data||[], trash=trashR.data||[];
  v.innerHTML=`<div class="toolbar"><div><h2>Funis</h2><p>Controle múltiplos funis sem limitar quantidade.</p></div><div style="display:flex;gap:8px"><button class="secondary" onclick="document.getElementById('trashPanel').scrollIntoView({behavior:'smooth'})">Lixeira (${trash.length})</button><button class="primary" onclick="newFunnel()">+ Conectar funil</button></div></div>
  <div class="card tableWrap"><table><thead><tr><th>Funil</th><th>Status</th><th>URL</th><th>Última comunicação</th><th></th></tr></thead><tbody>${rows.length?rows.map(f=>`<tr><td><b>${esc(f.nome||f.name||'Sem nome')}</b></td><td>${badge(f.status)}</td><td>${esc(f.url||'—')}</td><td>${f.last_communication?new Date(f.last_communication).toLocaleString('pt-BR'):'—'}</td><td><button class="secondary" onclick="disconnectFunnel('${f.id}')">Desconectar</button> <button class="danger" onclick="deleteFunnel('${f.id}')">Lixeira</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhum funil conectado.</td></tr>'}</tbody></table></div>
  <section id="trashPanel" class="card tableWrap" style="margin-top:18px"><div class="sectionHead"><div><h3>🗑️ Lixeira</h3><small>Funis removidos da operação. Os dados históricos permanecem preservados.</small></div></div><table><thead><tr><th>Funil</th><th>Removido em</th><th></th></tr></thead><tbody>${trash.length?trash.map(f=>`<tr><td><b>${esc(f.nome||f.name||'Sem nome')}</b></td><td>${f.deleted_at?new Date(f.deleted_at).toLocaleString('pt-BR'):'—'}</td><td><button class="secondary" onclick="restoreFunnel('${f.id}')">Restaurar</button> <button class="danger" onclick="permanentlyDeleteFunnel('${f.id}')">Excluir permanentemente</button></td></tr>`).join(''):'<tr><td colspan="3" class="empty">A lixeira está vazia.</td></tr>'}</tbody></table></section>`;
}