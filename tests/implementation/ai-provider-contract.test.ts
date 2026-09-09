import { describe,expect,it,vi } from 'vitest'

describe('revenue agent provider contract',()=>{
  it('keeps the provider opt-in and falls back safely when no key is configured',async()=>{
    const old=process.env.ALTHEA_AI_API_KEY
    const oldOpenAI=process.env.OPENAI_API_KEY
    delete process.env.ALTHEA_AI_API_KEY
    delete process.env.OPENAI_API_KEY
    vi.resetModules()
    const {generateRevenueAgentDraft}=await import('@/lib/crm/ai/provider')
    const result=await generateRevenueAgentDraft({conversationId:'00000000-0000-4000-8000-000000000000',recommendation:'qualification',probability:.4,recoveryProbability:.2,rationale:'grounded',evidence:{source:'test'}})
    expect(result.available).toBe(false)
    expect(result.draft).toBeNull()
    expect(result.mode).toBe('grounded_behavioral_fallback')
    if(old===undefined)delete process.env.ALTHEA_AI_API_KEY; else process.env.ALTHEA_AI_API_KEY=old
    if(oldOpenAI===undefined)delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=oldOpenAI
  })
})
