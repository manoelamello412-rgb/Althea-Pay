// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeNext, authLink } from '@/lib/auth/navigation'
import { createRequestGuard, eventBelongsToConversation } from '@/lib/crm/frontend-state'
import CRMPage from '@/app/dashboard/crm/page'
import ProductsPage from '@/app/dashboard/produtos/page'
import ErrorPage from '@/app/error'
import GlobalError from '@/app/global-error'
import ResetPasswordPage from '@/app/reset-password/page'

type Row = Record<string, any>
const mock = vi.hoisted(() => ({
  rpc: vi.fn(), tables: {} as Record<string, Row[]>, handlers: {} as Record<string, (event: any) => void>,
  channels: vi.fn(), remove: vi.fn(), subscribe: undefined as undefined | ((status: string) => void),
  replace: vi.fn(), exchange: vi.fn(), getSession: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mock.replace, push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => client }))
const client = {
  auth: {
    getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
    exchangeCodeForSession: mock.exchange, getSession: mock.getSession,
    onAuthStateChange: () => ({ data: { listener: null, subscription: { unsubscribe: vi.fn() } } }),
  },
  rpc: mock.rpc,
  from(table: string) {
    const filters: [string, unknown][] = []
    let limit = Infinity
    const result = () => (mock.tables[table] ?? []).filter(row => filters.every(([key,value]) => row[key] === value)).slice(0,limit)
    const builder = {
      select: () => builder, order: () => builder,
      eq: (key: string, value: unknown) => { filters.push([key,value]); return builder },
      is: () => builder,
      limit: (count: number) => { limit=count; return builder },
      maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve),
    }
    return builder
  },
  channel: (name: string) => {
    mock.channels(name)
    const channel = {
      on: (_kind: string, options: { table: string }, handler: (event: any) => void) => { mock.handlers[options.table]=handler; return channel },
      subscribe: (callback?: (status: string) => void) => { mock.subscribe=callback; return channel },
    }
    return channel
  },
  removeChannel: mock.remove,
}

const idA = '11111111-1111-4111-8111-111111111111'
const idB = '22222222-2222-4222-8222-222222222222'
const conversation = (id: string, name: string) => ({ id, buyer_name:name, user_id:'owner', transaction_id:`tx-${id}`, updated_at:'2026-09-19', created_at:'2026-09-19', status:'open', unread_count:0, metadata:{} })
const a = conversation(idA,'Cliente A'), b = conversation(idB,'Cliente B')
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve=done })
  return { promise, resolve }
}
let container: HTMLDivElement, root: Root
async function mount(component: () => ReturnType<typeof createElement>, strict = false) {
  await act(async () => { root.render(strict ? createElement(StrictMode,null,createElement(component)) : createElement(component)) })
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(el => el.textContent?.includes(text))
  expect(button, `button ${text}`).toBeTruthy()
  await act(async () => { button!.click() })
}
beforeEach(() => {
  vi.clearAllMocks(); mock.rpc.mockReset(); mock.tables={}; mock.handlers={}
  mock.subscribe=undefined; window.history.replaceState(null,'','/dashboard/crm')
  Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true })
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  mock.rpc.mockImplementation(async (name: string) => ({ data: name === 'crm_multicrm_conversations_page' ? { items:[a,b],has_more:false } : name === 'crm_multicrm_messages_page' ? {items:[],has_more:false} : {}, error:null }))
  mock.exchange.mockResolvedValue({error:null});mock.getSession.mockResolvedValue({data:{session:{access_token:'test'}},error:null})
})
afterEach(async () => { await act(async () => root.unmount());container.remove();vi.useRealTimers() })

describe('safe auth navigation', () => {
  it('keeps local destinations including query and rejects external URLs and auth loops', () => {
    expect(safeNext('/dashboard/crm?conversation=123')).toBe('/dashboard/crm?conversation=123')
    for (const value of ['https://evil.test','//evil.test','/\\evil.test','javascript:alert(1)','/login','/forgot-password','/reset-password','/\nevil']) expect(safeNext(value)).toBe('/dashboard')
    expect(authLink('/reset-password','?next=%2Fdashboard%2Fcrm%3Fconversation%3D123')).toBe('/reset-password?next=%2Fdashboard%2Fcrm%3Fconversation%3D123')
  })
  it('awaits automatic recovery under StrictMode without exchanging the code again', async () => {
    window.history.replaceState(null,'','/reset-password?code=one-time&next=%2Fdashboard%2Fprodutos')
    await mount(ResetPasswordPage,true)
    expect(mock.exchange).not.toHaveBeenCalled()
    expect(mock.getSession).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Atualizar senha')
    expect(container.textContent).not.toContain('inválido')
    expect(window.location.search).toBe('?next=%2Fdashboard%2Fprodutos')
  })
  it('calls the supported retry callback', async () => {
    const retry=vi.fn(), logged=vi.spyOn(console,'error').mockImplementation(() => {})
    await act(async () => root.render(createElement(ErrorPage,{error:new Error('test'),retry})))
    expect(container.textContent).toContain('Algo não saiu como esperado.')
    await click('Tentar novamente');expect(retry).toHaveBeenCalledOnce();logged.mockRestore()
  })
  it('wires the global error button to retry', () => {
    const retry=vi.fn()
    const walk=(element: any): any => {
      if (!element || typeof element !== 'object') return null
      if (element.type==='button') return element
      return [element.props?.children].flat().map(walk).find(Boolean)
    }
    const button=walk(GlobalError({error:new Error('test'),retry}))
    expect(button).toBeTruthy();button.props.onClick();expect(retry).toHaveBeenCalledOnce()
  })
})

describe('CRM stability', () => {
  it('ignores an older search response without reconnecting realtime', async () => {
    const stale=deferred<any>()
    mock.rpc.mockImplementation(async (name: string,args: Row) => {
      if(name!=='crm_multicrm_conversations_page')return {data:{},error:null}
      if(args.p_query==='old')return stale.promise
      return {data:{items:args.p_query==='new'?[b]:[a,b],has_more:false},error:null}
    })
    await mount(CRMPage)
    const input=container.querySelector('input[placeholder^="Buscar"]') as HTMLInputElement
    for(const value of ['old','new']) await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value)
      input.dispatchEvent(new Event('input',{bubbles:true}))
    })
    await act(async () => stale.resolve({data:{items:[a],has_more:false},error:null}))
    expect(container.textContent).toContain('Cliente B');expect(container.textContent).not.toContain('Cliente A')
    expect(mock.channels).toHaveBeenCalledTimes(1)
  })
  it('appends pages without resetting the list or recreating subscriptions; reconnect keeps loaded pages', async () => {
    mock.rpc.mockImplementation(async (name: string, args: Row) => ({ data:name==='crm_multicrm_conversations_page' ? args.p_cursor_id ? {items:[b],has_more:false} : {items:[a],has_more:true,next_cursor:{id:idA,updated_at:a.updated_at}} : {items:[],has_more:false},error:null }))
    await mount(CRMPage)
    await click('Carregar mais conversas')
    expect(container.textContent).toContain('Cliente A');expect(container.textContent).toContain('Cliente B')
    expect(mock.rpc.mock.calls.filter(([name]) => name==='crm_multicrm_conversations_page')).toHaveLength(2)
    expect(mock.channels).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    await act(async () => { mock.subscribe?.('SUBSCRIBED');await vi.advanceTimersByTimeAsync(151) })
    expect(container.textContent).toContain('Cliente B')
    expect(mock.channels).toHaveBeenCalledTimes(1)
    expect(mock.rpc.mock.calls.filter(([name]) => name==='crm_multicrm_conversations_page')).toHaveLength(4)
  })
  it('ignores old messages and Customer 360 after A → B → A', async () => {
    const oldMessages=deferred<any>(),oldCustomer=deferred<any>()
    let messageCalls=0,customerCalls=0
    mock.rpc.mockImplementation(async (name: string,args: Row) => {
      if(name==='crm_multicrm_conversations_page')return {data:{items:[a,b]},error:null}
      if(name==='crm_multicrm_messages_page') {
        if(args.p_conversation_id===idA && ++messageCalls===1)return oldMessages.promise
        return {data:{items:[{id:'fresh',conversation_id:args.p_conversation_id,body:'Mensagem atual',created_at:'2026-09-19',metadata:{}}]},error:null}
      }
      if(name==='crm_customer_360' && args.p_conversation_id===idA && ++customerCalls===1)return oldCustomer.promise
      return {data:{profile:{customer:{phone:'PHONE-CURRENT'}}},error:null}
    })
    await mount(CRMPage);await click('Cliente A');await click('Cliente B');await click('Cliente A')
    await act(async () => {
      oldMessages.resolve({data:{items:[{id:'old',conversation_id:idA,body:'STALE-MESSAGE',metadata:{},created_at:'2026-09-18'}]}})
      oldCustomer.resolve({data:{profile:{customer:{phone:'STALE-PHONE'}}}})
    })
    expect(container.textContent).toContain('Mensagem atual');expect(container.textContent).not.toContain('STALE-MESSAGE');expect(container.textContent).not.toContain('STALE-PHONE')
    expect(mock.channels).toHaveBeenCalledTimes(1)
  })
  it('updates existing messages and isolates financial events by transaction', async () => {
    await mount(CRMPage);await click('Cliente A')
    const message={id:'m1',conversation_id:idA,body:'original',created_at:'2026-09-19',metadata:{}}
    await act(async () => mock.handlers.crm_messages({eventType:'INSERT',new:message}))
    await act(async () => mock.handlers.crm_messages({eventType:'UPDATE',new:{...message,body:'updated'}}))
    expect(container.textContent).toContain('updated');expect(container.textContent).not.toContain('original')
    await act(async () => mock.handlers.crm_webhook_events({eventType:'INSERT',new:{id:'wrong',transaction_id:b.transaction_id,received_at:'2026-09-19',payload:{phone:'WRONG-PHONE'}}}))
    expect(container.textContent).not.toContain('WRONG-PHONE')
    await act(async () => mock.handlers.crm_webhook_events({eventType:'INSERT',new:{id:'right',transaction_id:a.transaction_id,received_at:'2026-09-19',payload:{phone:'RIGHT-PHONE'}}}))
    expect(container.textContent).toContain('RIGHT-PHONE')
  })
  it('opens recovery only when an owned event resolves to exactly one conversation', async () => {
    window.history.replaceState(null,'',`/dashboard/crm?recovery_event=${idA}`)
    mock.tables.crm_webhook_events=[{id:idA,user_id:'owner',transaction_id:b.transaction_id}]
    mock.tables.crm_conversations=[a,b]
    await mount(CRMPage)
    expect(mock.rpc).toHaveBeenCalledWith('crm_customer_360',{p_conversation_id:idB})
  })
  it('does not guess the recovery conversation when the transaction is ambiguous', async () => {
    window.history.replaceState(null,'',`/dashboard/crm?recovery_event=${idA}`)
    mock.tables.crm_webhook_events=[{id:idA,user_id:'owner',transaction_id:a.transaction_id}]
    mock.tables.crm_conversations=[a,{...b,transaction_id:a.transaction_id}]
    await mount(CRMPage)
    expect(container.textContent).toContain('uma única conversa')
    expect(mock.rpc.mock.calls.some(([name])=>name==='crm_customer_360')).toBe(false)
  })
  it('invalidates each request lane and never matches financial context by absent IDs', () => {
    const guard=createRequestGuard(),old=guard.begin('messages'),events=guard.begin('events')
    guard.begin('messages');expect(old()).toBe(false);expect(events()).toBe(true)
    guard.invalidate();expect(events()).toBe(false)
    expect(eventBelongsToConversation({transaction_id:null},{transaction_id:null})).toBe(false)
  })
})

describe('product editing', () => {
  it('sends existing nested metadata and the original version when other fields change', async () => {
    const metadata={integration:{external_id:'keep-me'},tags:['one','two'],enabled:false}
    mock.tables.products=[{id:'prod_one',name:'Produto existente',slug:'existing',status:'draft',billing_type:'one_time',product_type:'digital',unit_amount:10,currency:'BRL',metadata,version:7}]
    await mount(ProductsPage)
    await click('Editar')
    const input=container.querySelector('form input') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Nome alterado')
      input.dispatchEvent(new Event('input',{bubbles:true}))
    })
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
    expect(mock.rpc).toHaveBeenCalledWith('update_product',expect.objectContaining({p_name:'Nome alterado',p_metadata:metadata,p_version:7}))
    expect(metadata.integration.external_id).toBe('keep-me')
  })
})
