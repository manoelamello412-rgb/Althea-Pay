import { describe, expect, test } from 'vitest'
import { candidateGatewayIds } from '../../supabase/functions/_shared/gateway-candidates'

const row = (gateway_id: string) => ({ gateway_id, routing_score: 140, healthy: true, circuit_state: 'closed' })

describe('gateway ranking database boundary', () => {
  test('preserves ranked order and accepts no eligible gateways', () => {
    expect(candidateGatewayIds([row('b'), row('a')], new Set(['a', 'b']))).toEqual(['b', 'a'])
    expect(candidateGatewayIds([], new Set(['a']))).toEqual([])
  })
  test.each([null, {}, [null], [row('foreign')], [row('a'), row('a')],
    [{ ...row('a'), routing_score: NaN }], [{ ...row('a'), circuit_state: 'open' }]])(
    'rejects malformed or unauthorized candidates before a transaction is created: %j', (value) => {
      expect(() => candidateGatewayIds(value, new Set(['a']))).toThrow('invalid_gateway_ranking_response')
    },
  )
})
