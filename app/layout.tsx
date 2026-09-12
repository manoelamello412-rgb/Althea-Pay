import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Space_Grotesk } from 'next/font/google'
import './althea-styles.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ALTHEA PAY — Control Center',
  description: 'Central de controle, inteligência e operações dos seus funis.',
  icons: {
    icon: '/althea-mark.png',
    shortcut: '/althea-mark.png',
    apple: '/althea-mark.png',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={spaceGrotesk.variable}>
        <style dangerouslySetInnerHTML={{ __html: `
          .wl-sidebar{width:244px!important;padding:16px 11px!important;background:rgba(6,11,9,.985)!important;backdrop-filter:blur(18px);border-right:1px solid rgba(255,255,255,.07)!important}
          .wl-shell.is-collapsed .wl-sidebar{width:76px!important}
          .wl-brand{height:52px!important;padding:0 9px!important;margin-bottom:14px!important}
          .wl-brand img{width:31px!important;height:38px!important}
          .wl-brand>b{font-size:13px!important;letter-spacing:.15em!important}
          .wl-sidebar nav{padding:2px 0 12px!important;scrollbar-width:none}
          .wl-sidebar nav::-webkit-scrollbar{display:none}
          .wl-nav-group{margin-bottom:0!important}
          .wl-nav-group small{display:none!important}
          .wl-sidebar nav>div:nth-child(1)::before,.wl-sidebar nav>div:nth-child(3)::before,.wl-sidebar nav>div:nth-child(4)::before,.wl-sidebar nav>div:nth-child(5)::before,.wl-sidebar nav>div:nth-child(6)::before,.wl-sidebar nav>div:nth-child(7)::before,.wl-sidebar nav>div:nth-child(8)::before{display:block;padding:12px 10px 6px;color:#52635a;font-size:8px;font-weight:700;letter-spacing:.18em;line-height:1}
          .wl-sidebar nav>div:nth-child(1)::before{content:'OPERAR'}
          .wl-sidebar nav>div:nth-child(3)::before{content:'RECEBER'}
          .wl-sidebar nav>div:nth-child(4)::before{content:'VENDER'}
          .wl-sidebar nav>div:nth-child(5)::before{content:'RELACIONAR'}
          .wl-sidebar nav>div:nth-child(6)::before{content:'ANALISAR'}
          .wl-sidebar nav>div:nth-child(7)::before{content:'CONSTRUIR'}
          .wl-sidebar nav>div:nth-child(8)::before{content:'ADMINISTRAR'}
          .wl-sidebar nav>div:nth-child(3)::before,.wl-sidebar nav>div:nth-child(4)::before,.wl-sidebar nav>div:nth-child(5)::before,.wl-sidebar nav>div:nth-child(6)::before,.wl-sidebar nav>div:nth-child(7)::before,.wl-sidebar nav>div:nth-child(8)::before{margin-top:7px;border-top:1px solid rgba(255,255,255,.045)}
          .wl-nav-group button,.wl-sidebar-footer button{min-height:40px!important;margin:2px 0!important;padding:9px 10px!important;border:1px solid transparent!important;border-radius:11px!important;gap:11px!important;color:#8e9b94!important;font-size:11px!important;font-weight:600!important;letter-spacing:-.01em!important;transition:background .16s ease,border-color .16s ease,color .16s ease,transform .16s ease!important}
          .wl-nav-group button svg,.wl-sidebar-footer button svg{width:16px!important;height:16px!important;flex:0 0 16px!important;color:#65736b!important;stroke-width:1.8!important}
          .wl-nav-group button:hover,.wl-nav-group button.active,.wl-sidebar-footer button:hover{background:linear-gradient(90deg,rgba(29,184,84,.14),rgba(29,184,84,.055))!important;border-color:rgba(29,184,84,.16)!important;color:#f4faf6!important;transform:translateX(1px)}
          .wl-nav-group button.active{box-shadow:inset 2px 0 0 #1db854,0 6px 20px rgba(0,0,0,.12)!important}
          .wl-nav-group button.active svg{color:#36d86a!important}
          .wl-sidebar nav>div:nth-child(3) button span,.wl-sidebar nav>div:nth-child(4) button span,.wl-sidebar nav>div:nth-child(5) button span,.wl-sidebar nav>div:nth-child(7) button span,.wl-sidebar nav>div:nth-child(8) button span{font-size:0!important}
          .wl-sidebar nav>div:nth-child(3) button span::after{content:'Gateways';font-size:11px}
          .wl-sidebar nav>div:nth-child(4) button span::after{content:'Funis';font-size:11px}
          .wl-sidebar nav>div:nth-child(5) button span::after{content:'Clientes';font-size:11px}
          .wl-sidebar nav>div:nth-child(7) button span::after{content:'Integrações';font-size:11px}
          .wl-sidebar nav>div:nth-child(8) button span::after{content:'Configurações';font-size:11px}
          .wl-main{width:calc(100% - 244px)!important;margin-left:244px!important;padding:26px 30px 56px!important}
          .wl-shell.is-collapsed .wl-main{width:calc(100% - 76px)!important;margin-left:76px!important}
          .wl-header{margin-bottom:20px!important}
          .wl-header h1{font-size:30px!important;letter-spacing:-.045em!important}
          @media(max-width:900px){
            .wl-sidebar{width:250px!important}
            .wl-shell.is-collapsed .wl-sidebar{width:250px!important}
            .wl-main,.wl-shell.is-collapsed .wl-main{width:100%!important;margin-left:0!important;padding:65px 14px 30px!important}
          }
          @media(max-width:520px){.wl-main{padding-left:10px!important;padding-right:10px!important}}
        ` }} />
        {children}
      </body>
    </html>
  )
}
