import { describe, expect, it } from 'vitest'
import { resolveRecoveryContext, resolveRecoveryEventResponse } from '@/lib/crm/recovery-context'

const conversationId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'

describe('canonical recovery contract', () => {
  it('resolves solely from the explicit backend fields, without requiring a transaction', () => {
    expect(resolveRecoveryContext({ context_status:'resolved', conversation_id:conversationId, transaction_id:null })).toEqual({ status:'resolved', conversationId })
  })
  it.each(['unlinked','ambiguous'] as const)('honors %s even if a conversation ID is supplied', status => {
    expect(resolveRecoveryContext({context_status:status,conversation_id:conversationId}).status).toBe(status)
  })
  it.each([
    null, {}, {transaction_id:'unique-transaction',buyer_email:'shared@example.com'},
    {conversation_id:conversationId}, {context_status:'resolved'},
    {context_status:'resolved',conversation_id:null}, {context_status:'resolved',conversation_id:''},
    {context_status:'resolved',conversation_id:'invalid'}, {context_status:'unknown',conversation_id:conversationId},
  ])('fails closed for missing or invalid contract fields: %j', value => {
    expect(resolveRecoveryContext(value).status).toBe('unavailable')
  })
  it('selects by exact event ID, not by list order or a shared transaction', () => {
    expect(resolveRecoveryEventResponse({opportunities:[
      {event_id:'other',context_status:'unlinked',conversation_id:null},
      {event_id:eventId,context_status:'resolved',conversation_id:conversationId},
    ]},eventId)).toEqual({status:'resolved',conversationId})
  })
  it.each([null,{}, {opportunities:null}, {opportunities:[]}, {opportunities:[
    {event_id:eventId,context_status:'resolved',conversation_id:conversationId},
    {event_id:eventId,context_status:'resolved',conversation_id:conversationId},
  ]}])('does not guess when the event is absent, duplicated or malformed: %j', body => {
    expect(resolveRecoveryEventResponse(body,eventId).status).toBe('unavailable')
  })
})
