'use client'

import { useState } from 'react'
import { Copy, KeyRound, Link2, CheckCircle2 } from 'lucide-react'
import './page.css'

export default function NewFunnelPage() {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function provision() {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch('/api/funnels/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: url || null, connection_type: 'script' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Não foi possível preparar o funil.')
      setResult(data)
    } catch (e: any) {
      setError(e?.message || 'Erro ao preparar o funil.')
    } finally {
      setLoading(false)
    }
  }

  const token = result?.ingestion?.token || ''
  return (
    <main className="funnel-provision">
      <section className="funnel-card">
        <span className="eyebrow">ALTHEA PAY · NOVO FUNIL</span>
        <h1>Conectar um novo funil</h1>
        <p>Prepare a conexão agora. O funil pode ser criado depois, em qualquer stack ou domínio, sem alterar o núcleo da ALTHEA.</p>
        <label>Nome do funil<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Funil Produto X" /></label>
        <label>URL do funil <small>(opcional)</small><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seufunil.com" /></label>
        <button className="primary" disabled={loading || !name.trim()} onClick={provision}><Link2 />{loading ? 'Preparando…' : 'Preparar conexão'}</button>
        {error && <div className="error">{error}</div>}
        {result && <div className="success"><CheckCircle2 /><div><b>Conexão preparada</b><span>{result.funnel.nome} · {result.funnel.id}</span></div></div>}
        {token && <div className="secret"><div><KeyRound /><div><b>Token de ingestão</b><small>Copie agora. A ALTHEA armazena apenas o hash e não exibirá este segredo novamente.</small></div></div><code>{token}</code><button onClick={() => navigator.clipboard?.writeText(token)}><Copy /> Copiar</button></div>}
        {result && <div className="endpoint"><b>Endpoint de eventos</b><code>{result.ingestion.event_endpoint}</code><small>Envie os eventos do funil para este endpoint usando o token acima.</small></div>}
      </section>
    </main>
  )
}
