'use client'

import { useState } from 'react'
import { Activity, Bell, CheckCircle2, Copy, KeyRound, LockKeyhole, Network, Send, Settings2, ShieldCheck, Split, Webhook, Zap } from 'lucide-react'

const cards = [
  { title: 'Analytics & Reporting', eyebrow: 'BUSINESS INTELLIGENCE', icon: Activity, items: [['Receita por produto', 'Conectado'], ['Conversão por funil', 'Conectado'], ['Performance por gateway', 'Conectado'], ['Pix · Cartão · Boleto', 'Conectado']] },
  { title: 'Integration Hub', eyebrow: 'API & WEBHOOKS', icon: Network, items: [['API Keys', '2 ativas'], ['Outbound webhooks', '12 endpoints'], ['Retry tracker', 'Automático'], ['Eventos', 'Auditáveis']] },
  { title: 'Risk & Early Warning', eyebrow: 'PREVENÇÃO', icon: ShieldCheck, items: [['Score de risco', 'Monitorado'], ['Chargeback early warning', 'Ativo'], ['Regras de bloqueio', 'Configuráveis'], ['Disputas', 'Centralizadas']] },
]

export function AdvancedHub() {
  const [section, setSection] = useState<'analytics'|'integrations'|'risk'|'split'|'security'>('analytics')
  const [copied, setCopied] = useState(false)
  const [testing, setTesting] = useState(false)
  async function testEndpoint() { if (testing) return; setTesting(true); await new Promise(r => setTimeout(r, 600)); setTesting(false) }
  async function copyToken() { await navigator.clipboard?.writeText('althea_live_public••••••••'); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  return <section className="fc-advanced-grid">
    <div className="fc-advanced-tabs">
      {([['analytics','Analytics'],['integrations','Integrações'],['risk','Risco'],['split','Split'],['security','Segurança']] as const).map(([key,label]) => <button key={key} className={section===key?'active':''} onClick={() => setSection(key)}>{label}</button>)}
    </div>
    {section === 'analytics' && <div className="fc-advanced-cards">{cards.map(({title,eyebrow,icon:Icon,items}) => <article className="fc-panel fc-advanced-card" key={title}><div className="fc-advanced-title"><div className="fc-advanced-icon"><Icon size={17}/></div><div><span className="fc-eyebrow">{eyebrow}</span><h3>{title}</h3></div></div>{items.map(([a,b]) => <div className="fc-detail-row" key={a}><span>{a}</span><b>{b}</b></div>)}<button className="fc-outline">Abrir central <Zap size={13}/></button></article>)}</div>}
    {section === 'integrations' && <article className="fc-panel fc-hub-panel"><div className="fc-panel-head"><div><span className="fc-eyebrow">INTEGRATION HUB</span><h2>APIs, tokens e webhooks</h2><small>Controle operacional para integrações externas.</small></div><Webhook size={19}/></div><div className="fc-token-row"><KeyRound size={15}/><code>althea_live_public••••••••</code><button className="fc-outline" onClick={copyToken}>{copied ? <CheckCircle2 size={13}/> : <Copy size={13}/>} {copied ? 'Copiado' : 'Copiar'}</button></div><div className="fc-webhook-grid"><div><b>Outbound Webhook</b><span>https://merchant.example/webhooks</span><small>Última entrega · 200 OK · 184ms</small></div><div><b>Retry Tracker</b><span>0 falhas pendentes</span><small>Backoff progressivo habilitado</small></div><div><b>Test Endpoint</b><span>Envio controlado</span><button className="fc-outline" disabled={testing} onClick={testEndpoint}><Send size={13}/>{testing?'Testando…':'Testar endpoint'}</button></div></div></article>}
    {section === 'risk' && <article className="fc-panel fc-hub-panel"><div className="fc-panel-head"><div><span className="fc-eyebrow">EARLY WARNING</span><h2>Central de risco e chargeback</h2></div><ShieldCheck size={19}/></div><div className="fc-risk-banner"><ShieldCheck size={18}/><div><b>Monitoramento preventivo ativo</b><span>Disputas e sinais de risco ficam centralizados antes da contestação formal.</span></div></div><div className="fc-risk-grid"><div><b>12</b><span>Alertas analisados</span></div><div><b>0,21%</b><span>Chargeback rate</span></div><div><b>96/100</b><span>Health score</span></div><div><b>4</b><span>Revisões manuais</span></div></div></article>}
    {section === 'split' && <article className="fc-panel fc-hub-panel"><div className="fc-panel-head"><div><span className="fc-eyebrow">FINANCE HUB</span><h2>Split visual</h2><small>Defina participantes, percentuais e vínculo com produto.</small></div><Split size={19}/></div><div className="fc-split-flow"><div><small>Produto</small><b>Produto principal</b><span>100% base</span></div><div className="split-arrow">→</div><div><small>Produtor</small><b>70%</b><span>Conta principal</span></div><div><small>Afiliado</small><b>20%</b><span>Comissão</span></div><div><small>Agência</small><b>10%</b><span>Fee operacional</span></div></div><button className="fc-outline"><Settings2 size={13}/> Configurar contrato de split</button></article>}
    {section === 'security' && <article className="fc-panel fc-hub-panel"><div className="fc-panel-head"><div><span className="fc-eyebrow">SECURITY CENTER</span><h2>Auditoria e sessões</h2></div><LockKeyhole size={19}/></div><div className="fc-security-list"><div><CheckCircle2 size={15}/><span>2FA obrigatório para operações sensíveis</span><b>Ativo</b></div><div><Bell size={15}/><span>Alertas de login e mudança de credenciais</span><b>Ativo</b></div><div><Activity size={15}/><span>Logs de auditoria e IPs de acesso</span><b>Retenção configurada</b></div></div></article>}
  </section>
}
