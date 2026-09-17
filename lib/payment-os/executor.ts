import { createHash } from 'node:crypto'
import { PaymentOsError, type PaymentFlow, type PaymentProviderAdapter, type ProviderPaymentResult, type RoutingContext } from './types'
import { getOrderedFallbacks, resolveRoute } from './routing'
import { executeIdempotentMutation } from './transactional'
import { paymentProviderRegistry } from './provider-registry'

type Db = { from: (table: string) => any }
export type PaymentExecutionResult = { intentId:string; status:ProviderPaymentResult['status']; attemptId:string; gatewayConnectionId:string; externalPaymentId?:string; externalStatus?:string; errorCode?:string; errorMessage?:string }

type Intent = { id:string; organization_id:string; funnel_id:string; payment_flow_id:string|null; amount:number|string; currency:string; method:RoutingContext['method']; idempotency_key:string; metadata:Record<string,unknown>; status:ProviderPaymentResult['status'] }
const hash=(i:Intent)=>createHash('sha256').update(JSON.stringify({organizationId:i.organization_id,intentId:i.id,funnelId:i.funnel_id,amount:i.amount,currency:i.currency,method:i.method,metadata:i.metadata})).digest('hex')
const normalizeGateway=(r:any)=>({id:r.id,name:r.name,provider:r.provider,status:r.status,capabilities:r.capabilities??{methods:[],currencies:[]},publicConfig:r.public_config??{}})
const normalizeFlow=(r:any,v:any):PaymentFlow=>({id:r.id,funnelId:r.funnel_id,versionId:v.id,version:v.version,status:'published',steps:(v.payment_flow_steps??[]).map((s:any)=>({id:s.id,gatewayConnectionId:s.gateway_connection_id,stepOrder:s.step_order,method:s.method,action:s.action,conditions:s.conditions??{},retryableStatuses:s.retryable_statuses??[],maxAttempts:s.max_attempts,enabled:s.enabled}))})

export async function executePaymentIntent(input:{db:Db;organizationId:string;intentId:string;routingContext?:Partial<RoutingContext>}):Promise<PaymentExecutionResult>{
 const {data:intent,error}=await input.db.from('payment_intents').select('id,organization_id,funnel_id,payment_flow_id,amount,currency,method,idempotency_key,metadata,status').eq('id',input.intentId).eq('organization_id',input.organizationId).maybeSingle()
 if(error)throw error;if(!intent)throw new PaymentOsError('INTENT_NOT_FOUND','Payment intent was not found.')
 const i=intent as Intent;if(i.status==='paid'||i.status==='authorized')throw new PaymentOsError('INTENT_ALREADY_COMPLETED','Payment intent is already completed.')
 return executeIdempotentMutation({organizationId:input.organizationId,idempotencyKey:`execute:${i.idempotency_key}`,requestHash:hash(i),store:{async acquire({organizationId,key,requestHash}){
   const {data:row,error:insertError}=await input.db.from('payment_idempotency_locks').insert({organization_id:organizationId,idempotency_key:key,request_hash:requestHash,status:'processing'}).select('status,response,request_hash').maybeSingle()
   if(!insertError&&row)return{acquired:true,release:async(status,response)=>{await input.db.from('payment_idempotency_locks').update({status,response:response??null,completed_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('idempotency_key',key)}}
   if(insertError&&insertError.code!=='23505')throw insertError
   const {data:existing,error:readError}=await input.db.from('payment_idempotency_locks').select('status,response,request_hash').eq('organization_id',organizationId).eq('idempotency_key',key).maybeSingle()
   if(readError)throw readError;if(!existing)throw new PaymentOsError('IDEMPOTENCY_RACE','Unable to resolve idempotency state.',{retryable:true});if(existing.request_hash!==requestHash)throw new PaymentOsError('IDEMPOTENCY_KEY_REUSED','Idempotency key was reused with a different payment request.')
   return{acquired:false,response:existing.status==='completed'?existing.response:undefined,release:async()=>undefined}
 }},operation:async()=>{
   const {data:flowRow,error:flowError}=await input.db.from('payment_flows').select('id,funnel_id,version,status,payment_flow_versions!inner(id,version,status,payment_flow_steps(*))').eq('id',i.payment_flow_id).eq('funnel_id',i.funnel_id).eq('status','published').maybeSingle()
   if(flowError)throw flowError;if(!flowRow)throw new PaymentOsError('FLOW_NOT_FOUND','No published payment flow is available for this intent.')
   const version=(flowRow.payment_flow_versions??[]).find((v:any)=>v.status==='published');if(!version)throw new PaymentOsError('FLOW_VERSION_NOT_FOUND','No published payment flow version is available.')
   const flow=normalizeFlow(flowRow,version);const context:RoutingContext={amount:Number(i.amount),currency:i.currency,method:i.method,...(input.routingContext??{})};const first=resolveRoute(flow,context);const candidates=[first.step,...getOrderedFallbacks(flow,first.step)]
   let last:ProviderPaymentResult|undefined;let lastAttempt='';let lastGateway=''
   for(const step of candidates){
     const {data:gw,error:gwError}=await input.db.from('gateway_connections').select('id,name,provider,status,capabilities,public_config').eq('id',step.gatewayConnectionId).eq('organization_id',input.organizationId).maybeSingle();if(gwError)throw gwError;if(!gw)continue
     const conn=normalizeGateway(gw);lastGateway=conn.id;if(conn.status!=='connected'||!conn.capabilities.methods?.includes(i.method)||conn.capabilities.currencies?.length&&!conn.capabilities.currencies.includes(i.currency))continue
     const adapter:PaymentProviderAdapter|undefined=paymentProviderRegistry.get(conn.provider);if(!adapter)throw new PaymentOsError('PROVIDER_NOT_REGISTERED',`No adapter is registered for provider "${conn.provider}".`)
     const {data:max,error:maxError}=await input.db.from('payment_attempts').select('attempt_number').eq('payment_intent_id',i.id).order('attempt_number',{ascending:false}).limit(1).maybeSingle();if(maxError)throw maxError
     const {data:attempt,error:attemptError}=await input.db.from('payment_attempts').insert({payment_intent_id:i.id,gateway_connection_id:conn.id,flow_version_id:version.id,flow_step_id:step.id,attempt_number:(max?.attempt_number??0)+1,status:'pending'}).select('id').single();if(attemptError)throw attemptError;lastAttempt=attempt.id
     let result:ProviderPaymentResult;try{result=await adapter.createPayment({intentId:i.id,idempotencyKey:i.idempotency_key,amount:Number(i.amount),currency:i.currency,method:i.method,metadata:i.metadata??{}},conn)}catch(e){result={status:'unknown',errorCode:e instanceof PaymentOsError?e.code:'PROVIDER_ERROR',errorMessage:e instanceof Error?e.message:'Provider returned no definitive result.'}}
     await input.db.from('payment_attempts').update({status:result.status,external_payment_id:result.externalPaymentId??null,external_status:result.externalStatus??null,error_code:result.errorCode??null,error_message:result.errorMessage??null,response_metadata:result.responseMetadata??{},completed_at:new Date().toISOString()}).eq('id',attempt.id)
     if(result.status==='unknown'){await input.db.from('payment_intents').update({status:'unknown',updated_at:new Date().toISOString()}).eq('id',i.id);return{intentId:i.id,status:'unknown',attemptId:attempt.id,gatewayConnectionId:conn.id,externalPaymentId:result.externalPaymentId,externalStatus:result.externalStatus,errorCode:result.errorCode,errorMessage:result.errorMessage}}
     if(result.status==='paid'||result.status==='authorized'){await input.db.from('payment_intents').update({status:result.status,updated_at:new Date().toISOString()}).eq('id',i.id);return{intentId:i.id,status:result.status,attemptId:attempt.id,gatewayConnectionId:conn.id,externalPaymentId:result.externalPaymentId,externalStatus:result.externalStatus}}
     last=result;if(!(result.status==='failed'&&step.retryableStatuses.includes(result.externalStatus??result.errorCode??'failed')))break
   }
   await input.db.from('payment_intents').update({status:'failed',updated_at:new Date().toISOString()}).eq('id',i.id);return{intentId:i.id,status:'failed',attemptId:lastAttempt,gatewayConnectionId:lastGateway,errorCode:last?.errorCode??'NO_AVAILABLE_ROUTE',errorMessage:last?.errorMessage??'No gateway produced a definitive successful result.'}
 }}) as Promise<PaymentExecutionResult>
}
