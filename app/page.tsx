const metrics = [
  ['Funis conectados', '0', 'Pronto para receber seus primeiros funis'],
  ['Vendas espelhadas', '0', 'Nenhum evento de gateway ainda'],
  ['Conversas abertas', '0', 'O inbox aparecerá aqui em tempo real'],
  ['Gateways', '0', 'Conecte as gateways dos seus produtos'],
]

const modules = [
  ['Funis', 'Gerencie estruturas, conexões, versões e integrações dos seus funis.'],
  ['Gateways', 'Conecte gateways externas sem mover o dinheiro pelo ALTHEA.'],
  ['Vendas', 'Espelhe pagamentos, status, eventos e reconciliação.'],
  ['Chats', 'Centralize conversas dos seus futuros funis em um único inbox.'],
]

export default function Home() {
  return (
    <div className="althea-shell">
      <aside className="althea-sidebar">
        <div className="althea-brand">ALTHEA<span>CONTROL CENTER</span></div>
        <nav className="althea-nav" aria-label="Navegação principal">
          {['Visão geral', 'Funis', 'Produtos', 'Gateways', 'Vendas', 'Clientes', 'Chats', 'Analytics', 'Integrações', 'Configurações'].map((item) => (
            <a href="#" key={item}>{item}</a>
          ))}
        </nav>
      </aside>

      <main className="althea-main">
        <header className="althea-header">
          <div>
            <div className="althea-kicker">Control Center</div>
            <h1 className="althea-title">Sua operação, em um só lugar.</h1>
            <div className="althea-subtitle">
              O núcleo do ALTHEA está preparado para conectar seus funis independentes,
              espelhar gateways, centralizar chats e transformar eventos em inteligência operacional.
            </div>
          </div>
          <div className="althea-status">● Core preparado</div>
        </header>

        <section className="althea-grid" aria-label="Indicadores">
          {metrics.map(([label, value, note]) => (
            <article className="althea-card" key={label}>
              <div className="althea-card-label">{label}</div>
              <div className="althea-card-value">{value}</div>
              <div className="althea-card-note">{note}</div>
            </article>
          ))}
        </section>

        <section className="althea-section">
          <h2>Módulos do ALTHEA</h2>
          <div className="althea-grid">
            {modules.map(([title, description]) => (
              <article className="althea-card" key={title}>
                <div className="althea-card-label">MÓDULO</div>
                <div className="althea-card-value" style={{ fontSize: 20 }}>{title}</div>
                <div className="althea-card-note" style={{ lineHeight: 1.5 }}>{description}</div>
              </article>
            ))}
          </div>
        </section>

        <section className="althea-section althea-card">
          <h2>Atividade operacional</h2>
          <table className="althea-table">
            <thead><tr><th>Evento</th><th>Origem</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td>Core inicializado</td><td>ALTHEA</td><td><span className="althea-pill">Pronto</span></td></tr>
              <tr><td>Banco operacional</td><td>Supabase</td><td><span className="althea-pill">Aguardando conexão</span></td></tr>
              <tr><td>Primeiro funil</td><td>Externo</td><td><span className="althea-pill">Aguardando</span></td></tr>
            </tbody>
          </table>
        </section>
      </main>
    </div>
  )
}
