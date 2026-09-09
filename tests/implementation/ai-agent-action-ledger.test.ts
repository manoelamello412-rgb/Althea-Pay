import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const path='app/api/crm/ai-agent/route.ts'

describe('AI revenue agent action ledger contract',()=>{
  it('keeps the agent grounded and human-approved',async()=>{
    const source=await readFile(path,'utf8')
    expect(source).toContain("mode:'grounded_behavioral_v1'")
    expect(source).toContain('human_approval_required:true')
    expect(source).toContain("source:'crm_ai_agent'")
  })
  it('persists only controlled decision states',async()=>{
    const source=await readFile(path,'utf8')
    expect(source).toContain("['suggested','accepted','dismissed']")
    expect(source).toContain("from('crm_ai_actions')")
    expect(source).toContain(".eq('user_id',user.id)")
  })
})
