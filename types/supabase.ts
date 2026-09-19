// Generated from the live Althea Pay Supabase project during the 2026-09-17 audit.
// Regenerate after reviewed schema changes. Do not edit by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          amount_distributed: number
          commission_rate: number
          created_at: string
          id: string
          product_id: string | null
          sale_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          affiliate_id: string
          amount_distributed: number
          commission_rate: number
          created_at?: string
          id?: string
          product_id?: string | null
          sale_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          affiliate_id?: string
          amount_distributed?: number
          commission_rate?: number
          created_at?: string
          id?: string
          product_id?: string | null
          sale_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          metadata: Json
          name: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json
          name: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json
          name?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          revoked_at: string | null
          scopes: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          revoked_at?: string | null
          scopes?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          revoked_at?: string | null
          scopes?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limit_buckets: {
        Row: {
          api_key_id: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          api_key_id: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          api_key_id?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_rate_limit_buckets_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: true
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_logs: {
        Row: {
          api_key_id: string | null
          created_at: string
          error_code: string | null
          id: string
          ip_hash: string | null
          latency_ms: number | null
          method: string
          path: string
          request_id: string
          scope: string | null
          status_code: number | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          latency_ms?: number | null
          method: string
          path: string
          request_id: string
          scope?: string | null
          status_code?: number | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          latency_ms?: number | null
          method?: string
          path?: string
          request_id?: string
          scope?: string | null
          status_code?: number | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      attribution_sessions: {
        Row: {
          campaign: string | null
          click_id: string | null
          content: string | null
          first_seen_at: string
          funnel_id: string | null
          id: string
          landing_url: string | null
          last_seen_at: string
          medium: string | null
          metadata: Json
          session_key: string
          source: string | null
          term: string | null
          user_id: string
        }
        Insert: {
          campaign?: string | null
          click_id?: string | null
          content?: string | null
          first_seen_at?: string
          funnel_id?: string | null
          id?: string
          landing_url?: string | null
          last_seen_at?: string
          medium?: string | null
          metadata?: Json
          session_key: string
          source?: string | null
          term?: string | null
          user_id: string
        }
        Update: {
          campaign?: string | null
          click_id?: string | null
          content?: string | null
          first_seen_at?: string
          funnel_id?: string | null
          id?: string
          landing_url?: string | null
          last_seen_at?: string
          medium?: string | null
          metadata?: Json
          session_key?: string
          source?: string | null
          term?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip_hash: string | null
          metadata: Json
          organization_id: string | null
          request_id: string | null
          resource_id: string | null
          resource_type: string | null
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          organization_id?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          organization_id?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_execution_attempts: {
        Row: {
          attempt_no: number
          created_at: string
          error_message: string | null
          execution_id: string
          finished_at: string | null
          id: string
          next_retry_at: string | null
          output: Json | null
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          attempt_no: number
          created_at?: string
          error_message?: string | null
          execution_id: string
          finished_at?: string | null
          id?: string
          next_retry_at?: string | null
          output?: Json | null
          started_at?: string
          status: string
          user_id: string
        }
        Update: {
          attempt_no?: number
          created_at?: string
          error_message?: string | null
          execution_id?: string
          finished_at?: string | null
          id?: string
          next_retry_at?: string | null
          output?: Json | null
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_execution_attempts_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_executions: {
        Row: {
          action_type: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          error_message: string | null
          event_id: string | null
          execution_key: string
          id: string
          input: Json
          max_attempts: number
          next_retry_at: string | null
          output: Json
          replay_count: number
          replayed_at: string | null
          rule_id: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type?: string | null
          attempt_count?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          error_message?: string | null
          event_id?: string | null
          execution_key: string
          id?: string
          input?: Json
          max_attempts?: number
          next_retry_at?: string | null
          output?: Json
          replay_count?: number
          replayed_at?: string | null
          rule_id: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string | null
          attempt_count?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          error_message?: string | null
          event_id?: string | null
          execution_key?: string
          id?: string
          input?: Json
          max_attempts?: number
          next_retry_at?: string | null
          output?: Json
          replay_count?: number
          replayed_at?: string | null
          rule_id?: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "integration_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action_config: Json
          created_at: string
          id: string
          name: string
          status: string
          trigger_config: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          action_config?: Json
          created_at?: string
          id?: string
          name: string
          status?: string
          trigger_config?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          action_config?: Json
          created_at?: string
          id?: string
          name?: string
          status?: string
          trigger_config?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      brand_identity_settings: {
        Row: {
          created_at: string
          deep: string
          favicon_url: string
          forest: string
          gold: string
          green: string
          ink: string
          logo_dark_url: string
          logo_light_url: string
          logo_url: string
          silver: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deep?: string
          favicon_url?: string
          forest?: string
          gold?: string
          green?: string
          ink?: string
          logo_dark_url?: string
          logo_light_url?: string
          logo_url?: string
          silver?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deep?: string
          favicon_url?: string
          forest?: string
          gold?: string
          green?: string
          ink?: string
          logo_dark_url?: string
          logo_light_url?: string
          logo_url?: string
          silver?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          client_request_id: string | null
          content: string
          created_at: string
          id: string
          in_reply_to: string | null
          sender: string
          session_id: string
          user_id: string
        }
        Insert: {
          client_request_id?: string | null
          content: string
          created_at?: string
          id?: string
          in_reply_to?: string | null
          sender: string
          session_id: string
          user_id: string
        }
        Update: {
          client_request_id?: string | null
          content?: string
          created_at?: string
          id?: string
          in_reply_to?: string | null
          sender?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_in_reply_to_fkey"
            columns: ["in_reply_to"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chats: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      checkout_events: {
        Row: {
          checkout_id: string | null
          created_at: string
          event_type: string
          external_id: string | null
          id: string
          organization_id: string
          payload: Json
          user_id: string
        }
        Insert: {
          checkout_id?: string | null
          created_at?: string
          event_type: string
          external_id?: string | null
          id?: string
          organization_id: string
          payload?: Json
          user_id: string
        }
        Update: {
          checkout_id?: string | null
          created_at?: string
          event_type?: string
          external_id?: string | null
          id?: string
          organization_id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_events_checkout_fk"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_events_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_items: {
        Row: {
          checkout_id: string
          created_at: string
          id: string
          kind: string
          name: string
          organization_id: string
          product_id: string | null
          quantity: number
          unit_amount: number
          user_id: string
        }
        Insert: {
          checkout_id: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          organization_id: string
          product_id?: string | null
          quantity?: number
          unit_amount?: number
          user_id: string
        }
        Update: {
          checkout_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          organization_id?: string
          product_id?: string | null
          quantity?: number
          unit_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_items_checkout_fk"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_items_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_offers: {
        Row: {
          amount: number
          created_at: string
          enabled: boolean
          funnel_id: string | null
          id: string
          kind: string
          name: string
          product_id: string | null
          rules: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          enabled?: boolean
          funnel_id?: string | null
          id?: string
          kind?: string
          name: string
          product_id?: string | null
          rules?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          enabled?: boolean
          funnel_id?: string | null
          id?: string
          kind?: string
          name?: string
          product_id?: string | null
          rules?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checkout_sessions: {
        Row: {
          abandoned_at: string | null
          amount: number
          attribution: Json
          completed_at: string | null
          created_at: string
          currency: string
          customer: Json
          funnel_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          product_id: string | null
          recovery_count: number
          recovery_last_sent_at: string | null
          recovery_next_at: string | null
          recovery_status: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          abandoned_at?: string | null
          amount?: number
          attribution?: Json
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer?: Json
          funnel_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id: string
          product_id?: string | null
          recovery_count?: number
          recovery_last_sent_at?: string | null
          recovery_next_at?: string | null
          recovery_status?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          abandoned_at?: string | null
          amount?: number
          attribution?: Json
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer?: Json
          funnel_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: string
          product_id?: string | null
          recovery_count?: number
          recovery_last_sent_at?: string | null
          recovery_next_at?: string | null
          recovery_status?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_sessions_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_events: {
        Row: {
          created_at: string
          event_type: string
          external_id: string | null
          id: string
          occurred_at: string
          organization_id: string
          payload: Json
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          external_id?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          payload?: Json
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          external_id?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      core_job_queue: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string | null
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type?: string | null
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string | null
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_agents: {
        Row: {
          created_at: string
          id: string
          last_assigned_at: string
          name: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_assigned_at?: string
          name: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_assigned_at?: string
          name?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_ai_actions: {
        Row: {
          action_type: string
          conversation_id: string | null
          created_at: string
          executed_at: string | null
          executing_at: string | null
          execution_id: string | null
          execution_message_id: string | null
          execution_provenance: Json
          id: string
          idempotency_key: string | null
          payload: Json
          rationale: string
          score: number
          status: string
          user_id: string
        }
        Insert: {
          action_type: string
          conversation_id?: string | null
          created_at?: string
          executed_at?: string | null
          executing_at?: string | null
          execution_id?: string | null
          execution_message_id?: string | null
          execution_provenance?: Json
          id?: string
          idempotency_key?: string | null
          payload?: Json
          rationale?: string
          score?: number
          status?: string
          user_id: string
        }
        Update: {
          action_type?: string
          conversation_id?: string | null
          created_at?: string
          executed_at?: string | null
          executing_at?: string | null
          execution_id?: string | null
          execution_message_id?: string | null
          execution_provenance?: Json
          id?: string
          idempotency_key?: string | null
          payload?: Json
          rationale?: string
          score?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_ai_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_ai_actions_execution_message_id_fkey"
            columns: ["execution_message_id"]
            isOneToOne: false
            referencedRelation: "crm_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_channel_accounts: {
        Row: {
          channel: string
          created_at: string
          credentials_ref: string | null
          display_name: string | null
          external_account_id: string | null
          id: string
          metadata: Json
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          credentials_ref?: string | null
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          metadata?: Json
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          credentials_ref?: string | null
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          metadata?: Json
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_channel_delivery_events: {
        Row: {
          channel_account_id: string
          conversation_id: string | null
          created_at: string
          external_message_id: string
          id: string
          occurred_at: string
          provider_event: Json
          status: string
          user_id: string
        }
        Insert: {
          channel_account_id: string
          conversation_id?: string | null
          created_at?: string
          external_message_id: string
          id?: string
          occurred_at?: string
          provider_event?: Json
          status: string
          user_id: string
        }
        Update: {
          channel_account_id?: string
          conversation_id?: string | null
          created_at?: string
          external_message_id?: string
          id?: string
          occurred_at?: string
          provider_event?: Json
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_channel_delivery_events_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "crm_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_channel_delivery_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_channel_identities: {
        Row: {
          channel: string
          conversation_id: string | null
          created_at: string
          customer_id: string | null
          display_name: string | null
          email: string | null
          external_user_id: string
          id: string
          metadata: Json
          phone_e164: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          email?: string | null
          external_user_id: string
          id?: string
          metadata?: Json
          phone_e164?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          conversation_id?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          email?: string | null
          external_user_id?: string
          id?: string
          metadata?: Json
          phone_e164?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_channel_identities_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_channel_identities_customer_identity_fkey"
            columns: ["user_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      crm_channel_message_outbox: {
        Row: {
          attempts: number
          body: string
          channel: string
          channel_account_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          external_message_id: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          metadata: Json
          next_attempt_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body: string
          channel: string
          channel_account_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          external_message_id?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          channel_account_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string
          external_message_id?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_channel_message_outbox_channel_account_id_fkey"
            columns: ["channel_account_id"]
            isOneToOne: false
            referencedRelation: "crm_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_channel_message_outbox_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_channel_outbox_replay_events: {
        Row: {
          created_at: string
          id: string
          outbox_id: string
          reason: string | null
          replay_key: string
          requested_by: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          outbox_id: string
          reason?: string | null
          replay_key: string
          requested_by: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          outbox_id?: string
          reason?: string | null
          replay_key?: string
          requested_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_channel_outbox_replay_events_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "crm_channel_message_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversation_notes: {
        Row: {
          author_id: string | null
          body: string
          conversation_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversation_tags: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          tag: string
          tag_id: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          tag: string
          tag_id?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          tag?: string
          tag_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversations: {
        Row: {
          assigned_to: string | null
          buyer_email: string | null
          buyer_name: string | null
          channel_account_id: string | null
          checkout_status: Database["public"]["Enums"]["lead_checkout_status"]
          created_at: string
          customer_id: string | null
          customer_whatsapp: string | null
          first_response_at: string | null
          first_response_due_at: string | null
          funnel_id: string | null
          gateway_error_log: string | null
          id: string
          last_activity_at: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_direction: string | null
          metadata: Json
          primary_channel: string
          priority: string
          product_id: string | null
          public_token: string | null
          queue_entered_at: string | null
          quiz_answers: Json
          sla_breached_at: string | null
          status: string
          transaction_id: string | null
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          buyer_email?: string | null
          buyer_name?: string | null
          channel_account_id?: string | null
          checkout_status?: Database["public"]["Enums"]["lead_checkout_status"]
          created_at?: string
          customer_id?: string | null
          customer_whatsapp?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          funnel_id?: string | null
          gateway_error_log?: string | null
          id?: string
          last_activity_at?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?: string | null
          metadata?: Json
          primary_channel?: string
          priority?: string
          product_id?: string | null
          public_token?: string | null
          queue_entered_at?: string | null
          quiz_answers?: Json
          sla_breached_at?: string | null
          status?: string
          transaction_id?: string | null
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          buyer_email?: string | null
          buyer_name?: string | null
          channel_account_id?: string | null
          checkout_status?: Database["public"]["Enums"]["lead_checkout_status"]
          created_at?: string
          customer_id?: string | null
          customer_whatsapp?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          funnel_id?: string | null
          gateway_error_log?: string | null
          id?: string
          last_activity_at?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_direction?: string | null
          metadata?: Json
          primary_channel?: string
          priority?: string
          product_id?: string | null
          public_token?: string | null
          queue_entered_at?: string | null
          quiz_answers?: Json
          sla_breached_at?: string | null
          status?: string
          transaction_id?: string | null
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversations_customer_identity_fkey"
            columns: ["user_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      crm_experiment_exposures: {
        Row: {
          conversation_id: string | null
          experiment_id: string
          exposed_at: string
          id: string
          subject_key: string
          user_id: string
          variant_id: string
        }
        Insert: {
          conversation_id?: string | null
          experiment_id: string
          exposed_at?: string
          id?: string
          subject_key: string
          user_id: string
          variant_id: string
        }
        Update: {
          conversation_id?: string | null
          experiment_id?: string
          exposed_at?: string
          id?: string
          subject_key?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_experiment_exposures_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "crm_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_experiment_exposures_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "crm_experiment_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_experiment_guardrails: {
        Row: {
          created_at: string
          enabled: boolean
          experiment_id: string
          id: string
          max_regression: number
          metric_name: string
          metric_type: string
          min_sample_size: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          experiment_id: string
          id?: string
          max_regression?: number
          metric_name: string
          metric_type: string
          min_sample_size?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          experiment_id?: string
          id?: string
          max_regression?: number
          metric_name?: string
          metric_type?: string
          min_sample_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_experiment_guardrails_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "crm_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_experiment_outcomes: {
        Row: {
          experiment_id: string
          id: string
          occurred_at: string
          outcome: string
          subject_key: string
          user_id: string
          value: number | null
          variant_id: string
        }
        Insert: {
          experiment_id: string
          id?: string
          occurred_at?: string
          outcome: string
          subject_key: string
          user_id: string
          value?: number | null
          variant_id: string
        }
        Update: {
          experiment_id?: string
          id?: string
          occurred_at?: string
          outcome?: string
          subject_key?: string
          user_id?: string
          value?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_experiment_outcomes_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "crm_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_experiment_outcomes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "crm_experiment_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_experiment_promotions: {
        Row: {
          approved_at: string
          approved_by: string
          experiment_id: string
          id: string
          metadata: Json
          status: string
          user_id: string
          variant_id: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          experiment_id: string
          id?: string
          metadata?: Json
          status?: string
          user_id: string
          variant_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          experiment_id?: string
          id?: string
          metadata?: Json
          status?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_experiment_promotions_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "crm_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_experiment_promotions_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "crm_experiment_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_experiment_variants: {
        Row: {
          config: Json
          created_at: string
          experiment_id: string
          id: string
          name: string
          weight: number
        }
        Insert: {
          config?: Json
          created_at?: string
          experiment_id: string
          id?: string
          name: string
          weight?: number
        }
        Update: {
          config?: Json
          created_at?: string
          experiment_id?: string
          id?: string
          name?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_experiment_variants_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "crm_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_experiments: {
        Row: {
          created_at: string
          id: string
          max_sequential_looks: number
          name: string
          objective: string
          sequential_alpha: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_sequential_looks?: number
          name: string
          objective?: string
          sequential_alpha?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          max_sequential_looks?: number
          name?: string
          objective?: string
          sequential_alpha?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_messages: {
        Row: {
          body: string
          channel: string
          channel_account_id: string | null
          client_message_id: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: string
          external_message_id: string | null
          id: string
          metadata: Json
          provider: string
          sender_id: string | null
          sender_name: string | null
          user_id: string
        }
        Insert: {
          body: string
          channel?: string
          channel_account_id?: string | null
          client_message_id?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          direction: string
          external_message_id?: string | null
          id?: string
          metadata?: Json
          provider?: string
          sender_id?: string | null
          sender_name?: string | null
          user_id: string
        }
        Update: {
          body?: string
          channel?: string
          channel_account_id?: string | null
          client_message_id?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: string
          external_message_id?: string | null
          id?: string
          metadata?: Json
          provider?: string
          sender_id?: string | null
          sender_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_predictive_evaluations: {
        Row: {
          actual_conversion: boolean | null
          actual_ltv: number | null
          actual_recovery: boolean | null
          conversation_id: string
          created_at: string
          evaluated_at: string | null
          id: string
          model_version: string
          predicted_conversion: number
          predicted_ltv: number
          predicted_recovery: number
          user_id: string
        }
        Insert: {
          actual_conversion?: boolean | null
          actual_ltv?: number | null
          actual_recovery?: boolean | null
          conversation_id: string
          created_at?: string
          evaluated_at?: string | null
          id?: string
          model_version: string
          predicted_conversion: number
          predicted_ltv: number
          predicted_recovery: number
          user_id?: string
        }
        Update: {
          actual_conversion?: boolean | null
          actual_ltv?: number | null
          actual_recovery?: boolean | null
          conversation_id?: string
          created_at?: string
          evaluated_at?: string | null
          id?: string
          model_version?: string
          predicted_conversion?: number
          predicted_ltv?: number
          predicted_recovery?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_predictive_evaluations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_quick_replies: {
        Row: {
          active: boolean
          body: string
          channel: string
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          body: string
          channel?: string
          created_at?: string
          id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          body?: string
          channel?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_segments: {
        Row: {
          active: boolean
          created_at: string
          definition: Json
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          definition?: Json
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          definition?: Json
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_tags: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          priority: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_team_members: {
        Row: {
          active: boolean
          agent_id: string | null
          created_at: string
          id: string
          role: string
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          agent_id?: string | null
          created_at?: string
          id?: string
          role?: string
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          agent_id?: string | null
          created_at?: string
          id?: string
          role?: string
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_team_members_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "crm_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "crm_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_teams: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crm_webhook_events: {
        Row: {
          buyer_email: string | null
          buyer_name: string | null
          created_at: string
          error_reason: string | null
          id: string
          idempotency_key: string | null
          payload: Json
          processed_at: string | null
          received_at: string
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          buyer_email?: string | null
          buyer_name?: string | null
          created_at?: string
          error_reason?: string | null
          id?: string
          idempotency_key?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          status: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          buyer_email?: string | null
          buyer_name?: string | null
          created_at?: string
          error_reason?: string | null
          id?: string
          idempotency_key?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      dispute_evidence: {
        Row: {
          content: string | null
          created_at: string
          dispute_id: string
          evidence_type: string
          id: string
          metadata: Json
          storage_path: string | null
          title: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          dispute_id: string
          evidence_type: string
          id?: string
          metadata?: Json
          storage_path?: string | null
          title: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          dispute_id?: string
          evidence_type?: string
          id?: string
          metadata?: Json
          storage_path?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_evidence_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          due_at: string | null
          evidence: Json
          external_dispute_id: string | null
          gateway_id: string | null
          id: string
          metadata: Json
          organization_id: string
          reason: string | null
          resolved_at: string | null
          status: string
          submitted_at: string | null
          timeline: Json
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          due_at?: string | null
          evidence?: Json
          external_dispute_id?: string | null
          gateway_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          submitted_at?: string | null
          timeline?: Json
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          due_at?: string | null
          evidence?: Json
          external_dispute_id?: string | null
          gateway_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          reason?: string | null
          resolved_at?: string | null
          status?: string
          submitted_at?: string | null
          timeline?: Json
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      event_dead_letters: {
        Row: {
          attempts: number
          created_at: string
          event_id: string | null
          event_type: string | null
          first_failed_at: string
          id: string
          last_failed_at: string
          payload: Json
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_id?: string | null
          event_type?: string | null
          first_failed_at?: string
          id?: string
          last_failed_at?: string
          payload?: Json
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_id?: string | null
          event_type?: string | null
          first_failed_at?: string
          id?: string
          last_failed_at?: string
          payload?: Json
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_dead_letters_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "integration_events"
            referencedColumns: ["id"]
          },
        ]
      }
      feb_consumed_tickets: {
        Row: {
          action: string
          audience: string
          consumed_at: string
          execution_id: string
          expires_at: string
          gateway_id: string
          idempotency_key: string
          issued_at: string
          issuer: string
          jti: string
          kid: string
          request_fingerprint: string
          tenant_id: string
          tool_key: string
          tool_version: number
          user_id: string
        }
        Insert: {
          action: string
          audience: string
          consumed_at?: string
          execution_id: string
          expires_at: string
          gateway_id: string
          idempotency_key: string
          issued_at: string
          issuer: string
          jti: string
          kid: string
          request_fingerprint: string
          tenant_id: string
          tool_key: string
          tool_version: number
          user_id: string
        }
        Update: {
          action?: string
          audience?: string
          consumed_at?: string
          execution_id?: string
          expires_at?: string
          gateway_id?: string
          idempotency_key?: string
          issued_at?: string
          issuer?: string
          jti?: string
          kid?: string
          request_fingerprint?: string
          tenant_id?: string
          tool_key?: string
          tool_version?: number
          user_id?: string
        }
        Relationships: []
      }
      frontend_customer_tags: {
        Row: {
          created_at: string
          customer_key: string
          id: string
          tag: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_key: string
          id?: string
          tag: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_key?: string
          id?: string
          tag?: string
          user_id?: string
        }
        Relationships: []
      }
      frontend_device_sessions: {
        Row: {
          active: boolean
          created_at: string
          device: string
          id: string
          ip: string | null
          last_seen_at: string
          location: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          device: string
          id?: string
          ip?: string | null
          last_seen_at?: string
          location?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          device?: string
          id?: string
          ip?: string | null
          last_seen_at?: string
          location?: string | null
          user_id?: string
        }
        Relationships: []
      }
      frontend_funnel_domains: {
        Row: {
          created_at: string
          funnel_id: string
          hostname: string
          id: string
          user_id: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          funnel_id: string
          hostname: string
          id?: string
          user_id: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          funnel_id?: string
          hostname?: string
          id?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      frontend_funnel_experiments: {
        Row: {
          created_at: string
          enabled: boolean
          funnel_id: string
          id: string
          name: string
          traffic_a: number
          traffic_b: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          funnel_id: string
          id?: string
          name: string
          traffic_a?: number
          traffic_b?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          funnel_id?: string
          id?: string
          name?: string
          traffic_a?: number
          traffic_b?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      frontend_funnel_recovery: {
        Row: {
          channel: string
          created_at: string
          delay_minutes: number
          enabled: boolean
          funnel_id: string
          id: string
          message: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          delay_minutes?: number
          enabled?: boolean
          funnel_id: string
          id?: string
          message?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          delay_minutes?: number
          enabled?: boolean
          funnel_id?: string
          id?: string
          message?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      frontend_gateway_ui: {
        Row: {
          credential_label: string | null
          enabled: boolean
          gateway_id: string
          id: string
          provider: string
          public_config: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          credential_label?: string | null
          enabled?: boolean
          gateway_id: string
          id?: string
          provider: string
          public_config?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          credential_label?: string | null
          enabled?: boolean
          gateway_id?: string
          id?: string
          provider?: string
          public_config?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      frontend_hmac_keys: {
        Row: {
          created_at: string
          id: string
          key_prefix: string
          name: string
          revoked_at: string | null
          secret_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_prefix: string
          name: string
          revoked_at?: string | null
          secret_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_prefix?: string
          name?: string
          revoked_at?: string | null
          secret_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      frontend_settings: {
        Row: {
          base_currency: string
          checkout_theme: Json
          cname_domain: string | null
          default_fee: number
          oauth: Json
          timezone: string
          two_factor_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          base_currency?: string
          checkout_theme?: Json
          cname_domain?: string | null
          default_fee?: number
          oauth?: Json
          timezone?: string
          two_factor_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          base_currency?: string
          checkout_theme?: Json
          cname_domain?: string | null
          default_fee?: number
          oauth?: Json
          timezone?: string
          two_factor_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      frontend_webhook_retries: {
        Row: {
          attempts: number
          created_at: string
          event_id: string
          id: string
          last_attempt_at: string | null
          payload: Json
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_id: string
          id?: string
          last_attempt_at?: string | null
          payload?: Json
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_id?: string
          id?: string
          last_attempt_at?: string | null
          payload?: Json
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      funnel_automation_rules: {
        Row: {
          action_config: Json
          action_type: string
          conditions: Json
          created_at: string
          enabled: boolean
          funnel_id: string
          id: string
          name: string
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          conditions?: Json
          created_at?: string
          enabled?: boolean
          funnel_id: string
          id?: string
          name: string
          trigger_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          conditions?: Json
          created_at?: string
          enabled?: boolean
          funnel_id?: string
          id?: string
          name?: string
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_automation_rules_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_automation_rules_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
      funnel_connections: {
        Row: {
          config: Json
          connected_at: string | null
          connection_type: string
          created_at: string
          error_count: number | null
          event_count: number | null
          funnel_id: string | null
          health_status: string | null
          id: string
          last_error: string | null
          last_event_at: string | null
          organization_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          connected_at?: string | null
          connection_type?: string
          created_at?: string
          error_count?: number | null
          event_count?: number | null
          funnel_id?: string | null
          health_status?: string | null
          id?: string
          last_error?: string | null
          last_event_at?: string | null
          organization_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          connected_at?: string | null
          connection_type?: string
          created_at?: string
          error_count?: number | null
          event_count?: number | null
          funnel_id?: string | null
          health_status?: string | null
          id?: string
          last_error?: string | null
          last_event_at?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_connections_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_connections_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "funnel_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_event_types: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          event_type: string
        }
        Insert: {
          created_at?: string
          description: string
          enabled?: boolean
          event_type: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          event_type?: string
        }
        Relationships: []
      }
      funnel_gateway_bindings: {
        Row: {
          created_at: string
          funnel_id: string
          gateway_id: string
          id: string
          is_primary: boolean
          organization_id: string
          priority: number
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          funnel_id: string
          gateway_id: string
          id?: string
          is_primary?: boolean
          organization_id: string
          priority?: number
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          funnel_id?: string
          gateway_id?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          priority?: number
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_gateway_bindings_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_gateway_bindings_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "funnel_gateway_bindings_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_gateway_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_ingestion_tokens: {
        Row: {
          created_at: string
          enabled: boolean
          expires_at: string | null
          funnel_id: string
          id: string
          last_used_at: string | null
          organization_id: string
          revoked_at: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          funnel_id: string
          id?: string
          last_used_at?: string | null
          organization_id: string
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          funnel_id?: string
          id?: string
          last_used_at?: string | null
          organization_id?: string
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_ingestion_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_offers: {
        Row: {
          config: Json
          created_at: string
          currency: string
          funnel_id: string
          id: string
          name: string
          offer_type: string
          organization_id: string
          price: number
          product_id: string
          status: string
          step_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          currency?: string
          funnel_id: string
          id?: string
          name: string
          offer_type?: string
          organization_id: string
          price: number
          product_id: string
          status?: string
          step_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          currency?: string
          funnel_id?: string
          id?: string
          name?: string
          offer_type?: string
          organization_id?: string
          price?: number
          product_id?: string
          status?: string
          step_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_offers_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_offers_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "funnel_offers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_offers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "funnel_offers_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "funnel_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_step_links: {
        Row: {
          condition: Json
          created_at: string
          from_step_id: string
          funnel_id: string
          id: string
          organization_id: string
          priority: number
          to_step_id: string
          user_id: string
        }
        Insert: {
          condition?: Json
          created_at?: string
          from_step_id: string
          funnel_id: string
          id?: string
          organization_id: string
          priority?: number
          to_step_id: string
          user_id: string
        }
        Update: {
          condition?: Json
          created_at?: string
          from_step_id?: string
          funnel_id?: string
          id?: string
          organization_id?: string
          priority?: number
          to_step_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_step_links_from_step_id_fkey"
            columns: ["from_step_id"]
            isOneToOne: false
            referencedRelation: "funnel_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_step_links_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_step_links_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "funnel_step_links_to_step_id_fkey"
            columns: ["to_step_id"]
            isOneToOne: false
            referencedRelation: "funnel_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_steps: {
        Row: {
          config: Json
          created_at: string
          funnel_id: string
          id: string
          name: string
          organization_id: string
          position: number
          status: string
          step_key: string
          step_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          funnel_id: string
          id?: string
          name: string
          organization_id: string
          position: number
          status?: string
          step_key: string
          step_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          funnel_id?: string
          id?: string
          name?: string
          organization_id?: string
          position?: number
          status?: string
          step_key?: string
          step_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnel_steps_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_steps_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
      funnel_trash: {
        Row: {
          deleted_at: string
          funnel_id: string
          funnel_snapshot: Json
          id: string
          restored_at: string | null
          user_id: string
        }
        Insert: {
          deleted_at?: string
          funnel_id: string
          funnel_snapshot?: Json
          id?: string
          restored_at?: string | null
          user_id: string
        }
        Update: {
          deleted_at?: string
          funnel_id?: string
          funnel_snapshot?: Json
          id?: string
          restored_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      funnels: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          endpoint: string | null
          funnel_type: string
          id: string
          last_communication: string | null
          nome: string
          organization_id: string
          status: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          endpoint?: string | null
          funnel_type?: string
          id: string
          last_communication?: string | null
          nome: string
          organization_id: string
          status?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          endpoint?: string | null
          funnel_type?: string
          id?: string
          last_communication?: string | null
          nome?: string
          organization_id?: string
          status?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_checkout_mutations: {
        Row: {
          actor_id: string
          checkout_id: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          mutation_type: string
          new_amount: number
          previous_amount: number
          reason: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          actor_id: string
          checkout_id: string
          created_at?: string
          currency: string
          id?: string
          idempotency_key: string
          mutation_type: string
          new_amount: number
          previous_amount: number
          reason: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string
          checkout_id?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          mutation_type?: string
          new_amount?: number
          previous_amount?: number
          reason?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_checkout_mutations_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_checkout_mutations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_checkout_telemetry: {
        Row: {
          checkout_id: string | null
          created_at: string
          event_type: string
          field_name: string | null
          funnel_id: string | null
          id: string
          occurred_at: string
          payload: Json
          payment_method: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          checkout_id?: string | null
          created_at?: string
          event_type: string
          field_name?: string | null
          funnel_id?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          payment_method?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          checkout_id?: string | null
          created_at?: string
          event_type?: string
          field_name?: string | null
          funnel_id?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          payment_method?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_checkout_telemetry_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_checkout_telemetry_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_checkout_telemetry_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "gateway_checkout_telemetry_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_circuit_states: {
        Row: {
          circuit_state: string
          failure_count: number
          gateway_id: string
          gateway_name: string
          opened_at: string | null
          probe_until: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          circuit_state?: string
          failure_count?: number
          gateway_id: string
          gateway_name: string
          opened_at?: string | null
          probe_until?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          circuit_state?: string
          failure_count?: number
          gateway_id?: string
          gateway_name?: string
          opened_at?: string | null
          probe_until?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      gateway_decline_details: {
        Row: {
          attempt_id: string | null
          category: string
          created_at: string
          gateway_id: string | null
          id: string
          provider: string
          provider_code: string | null
          provider_request_id: string | null
          provider_subcode: string | null
          raw_error: Json
          safe_message: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          attempt_id?: string | null
          category: string
          created_at?: string
          gateway_id?: string | null
          id?: string
          provider: string
          provider_code?: string | null
          provider_request_id?: string | null
          provider_subcode?: string | null
          raw_error?: Json
          safe_message: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          attempt_id?: string | null
          category?: string
          created_at?: string
          gateway_id?: string | null
          id?: string
          provider?: string
          provider_code?: string | null
          provider_request_id?: string | null
          provider_subcode?: string | null
          raw_error?: Json
          safe_message?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_decline_details_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "gateway_payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_decline_details_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_decline_details_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_financial_entries: {
        Row: {
          account_code: string
          amount: number
          created_at: string
          currency: string
          direction: string
          id: string
          journal_id: string
          user_id: string
        }
        Insert: {
          account_code: string
          amount: number
          created_at?: string
          currency?: string
          direction: string
          id?: string
          journal_id: string
          user_id: string
        }
        Update: {
          account_code?: string
          amount?: number
          created_at?: string
          currency?: string
          direction?: string
          id?: string
          journal_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_financial_entries_journal_user_fkey"
            columns: ["journal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "gateway_financial_journals"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      gateway_financial_journals: {
        Row: {
          created_at: string
          currency: string
          gateway_id: string | null
          id: string
          journal_type: string
          metadata: Json
          posted_at: string
          source_event_key: string
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          gateway_id?: string | null
          id?: string
          journal_type: string
          metadata?: Json
          posted_at?: string
          source_event_key: string
          status?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          gateway_id?: string | null
          id?: string
          journal_type?: string
          metadata?: Json
          posted_at?: string
          source_event_key?: string
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_financial_journals_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_financial_journals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_health_snapshots: {
        Row: {
          checked_at: string
          circuit_state: string
          consecutive_failures: number
          details: Json
          gateway_id: string | null
          gateway_name: string
          id: string
          is_healthy: boolean
          latency_ms: number | null
          user_id: string | null
        }
        Insert: {
          checked_at?: string
          circuit_state?: string
          consecutive_failures?: number
          details?: Json
          gateway_id?: string | null
          gateway_name: string
          id?: string
          is_healthy: boolean
          latency_ms?: number | null
          user_id?: string | null
        }
        Update: {
          checked_at?: string
          circuit_state?: string
          consecutive_failures?: number
          details?: Json
          gateway_id?: string | null
          gateway_name?: string
          id?: string
          is_healthy?: boolean
          latency_ms?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      gateway_interchange_fees: {
        Row: {
          active: boolean
          card_brand: string
          created_at: string
          fixed_fee_minor: number
          gateway_id: string
          id: string
          percentage_fee: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          card_brand: string
          created_at?: string
          fixed_fee_minor?: number
          gateway_id: string
          id?: string
          percentage_fee?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          card_brand?: string
          created_at?: string
          fixed_fee_minor?: number
          gateway_id?: string
          id?: string
          percentage_fee?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_interchange_fees_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_operation_logs: {
        Row: {
          attempt: number
          created_at: string
          decision_reason: string | null
          duration_ms: number | null
          error_message: string | null
          gateway_id: string | null
          id: string
          operation: string
          provider_request_id: string | null
          request_meta: Json
          response_meta: Json
          routing_policy_id: string | null
          routing_policy_version: number | null
          score: number | null
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          decision_reason?: string | null
          duration_ms?: number | null
          error_message?: string | null
          gateway_id?: string | null
          id?: string
          operation: string
          provider_request_id?: string | null
          request_meta?: Json
          response_meta?: Json
          routing_policy_id?: string | null
          routing_policy_version?: number | null
          score?: number | null
          status: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          decision_reason?: string | null
          duration_ms?: number | null
          error_message?: string | null
          gateway_id?: string | null
          id?: string
          operation?: string
          provider_request_id?: string | null
          request_meta?: Json
          response_meta?: Json
          routing_policy_id?: string | null
          routing_policy_version?: number | null
          score?: number | null
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_operation_logs_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_operation_logs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_operator_events: {
        Row: {
          checkout_id: string | null
          created_at: string
          delivered_at: string | null
          event_type: string
          funnel_id: string | null
          id: string
          idempotency_key: string
          payload: Json
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          checkout_id?: string | null
          created_at?: string
          delivered_at?: string | null
          event_type: string
          funnel_id?: string | null
          id?: string
          idempotency_key: string
          payload?: Json
          status?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          checkout_id?: string | null
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          funnel_id?: string | null
          id?: string
          idempotency_key?: string
          payload?: Json
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_operator_events_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_operator_events_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_operator_events_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "gateway_operator_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_orchestration_traces: {
        Row: {
          created_at: string
          funnel_id: string | null
          id: string
          idempotency_key: string
          tenant_id: string
          trace_graph: Json
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          funnel_id?: string | null
          id?: string
          idempotency_key: string
          tenant_id: string
          trace_graph?: Json
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          funnel_id?: string | null
          id?: string
          idempotency_key?: string
          tenant_id?: string
          trace_graph?: Json
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_orchestration_traces_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_orchestration_traces_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "gateway_orchestration_traces_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_payment_attempts: {
        Row: {
          attempt_order: number
          completed_at: string | null
          created_at: string
          decision_reason: string | null
          duration_ms: number | null
          error_message: string | null
          external_transaction_id: string | null
          failure_class: string | null
          gateway_id: string | null
          gateway_name: string
          id: string
          idempotency_key: string
          organization_id: string
          product_id: string | null
          provider_request_id: string | null
          response_code: string | null
          routing_policy_id: string | null
          routing_policy_version: number | null
          routing_rule_id: string | null
          sale_id: string | null
          status: string
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_order: number
          completed_at?: string | null
          created_at?: string
          decision_reason?: string | null
          duration_ms?: number | null
          error_message?: string | null
          external_transaction_id?: string | null
          failure_class?: string | null
          gateway_id?: string | null
          gateway_name: string
          id?: string
          idempotency_key: string
          organization_id: string
          product_id?: string | null
          provider_request_id?: string | null
          response_code?: string | null
          routing_policy_id?: string | null
          routing_policy_version?: number | null
          routing_rule_id?: string | null
          sale_id?: string | null
          status?: string
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_order?: number
          completed_at?: string | null
          created_at?: string
          decision_reason?: string | null
          duration_ms?: number | null
          error_message?: string | null
          external_transaction_id?: string | null
          failure_class?: string | null
          gateway_id?: string | null
          gateway_name?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          product_id?: string | null
          provider_request_id?: string | null
          response_code?: string | null
          routing_policy_id?: string | null
          routing_policy_version?: number | null
          routing_rule_id?: string | null
          sale_id?: string | null
          status?: string
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_payment_attempts_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_payment_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_payment_attempts_routing_rule_id_fkey"
            columns: ["routing_rule_id"]
            isOneToOne: false
            referencedRelation: "gateway_routing_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_payment_attempts_transaction_tenant_fk"
            columns: ["transaction_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      gateway_payment_instruments: {
        Row: {
          brand: string | null
          created_at: string
          customer_ref: string
          id: string
          instrument_fingerprint: string | null
          last4: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          customer_ref: string
          id?: string
          instrument_fingerprint?: string | null
          last4?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          customer_ref?: string
          id?: string
          instrument_fingerprint?: string | null
          last4?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gateway_payment_link_execution_commands: {
        Row: {
          action: string
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          gateway_id: string
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          locked_at: string | null
          locked_by: string | null
          payment_link_id: string
          request_payload: Json
          result_payload: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action?: string
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          gateway_id: string
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          last_error_message?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payment_link_id: string
          request_payload?: Json
          result_payload?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          gateway_id?: string
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          last_error_message?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payment_link_id?: string
          request_payload?: Json
          result_payload?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_payment_link_execution_commands_payment_link_id_fkey"
            columns: ["payment_link_id"]
            isOneToOne: false
            referencedRelation: "gateway_payment_links"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_payment_links: {
        Row: {
          amount: number
          checkout_id: string | null
          created_at: string
          currency: string
          expires_at: string | null
          external_id: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          idempotency_key: string
          link_type: string
          metadata: Json
          payment_url: string | null
          pix_copy_paste: string | null
          provider: string | null
          qr_code_base64: string | null
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          checkout_id?: string | null
          created_at?: string
          currency: string
          expires_at?: string | null
          external_id?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id?: string
          idempotency_key: string
          link_type: string
          metadata?: Json
          payment_url?: string | null
          pix_copy_paste?: string | null
          provider?: string | null
          qr_code_base64?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          checkout_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          external_id?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id?: string
          idempotency_key?: string
          link_type?: string
          metadata?: Json
          payment_url?: string | null
          pix_copy_paste?: string | null
          provider?: string | null
          qr_code_base64?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_payment_links_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_payment_links_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_payment_links_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "gateway_payment_links_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_payment_links_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_payment_token_links: {
        Row: {
          created_at: string
          gateway_id: string
          id: string
          instrument_id: string
          provider: string
          secret_ref: string
          status: string
          token_fingerprint: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gateway_id: string
          id?: string
          instrument_id: string
          provider: string
          secret_ref: string
          status?: string
          token_fingerprint?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gateway_id?: string
          id?: string
          instrument_id?: string
          provider?: string
          secret_ref?: string
          status?: string
          token_fingerprint?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_payment_token_links_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_payment_token_links_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "gateway_payment_instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_provider_registry: {
        Row: {
          adapter_contract_version: number
          adapter_key: string | null
          adapter_url: string | null
          capabilities: Json
          created_at: string
          credential_schema: Json
          display_name: string
          execution_config: Json
          id: string
          is_active: boolean
          is_custom_or_webhook_only: boolean
          operational: boolean
          provider_key: string
          schema_version: number
          updated_at: string
          webhook_config: Json
        }
        Insert: {
          adapter_contract_version?: number
          adapter_key?: string | null
          adapter_url?: string | null
          capabilities?: Json
          created_at?: string
          credential_schema?: Json
          display_name: string
          execution_config?: Json
          id?: string
          is_active?: boolean
          is_custom_or_webhook_only?: boolean
          operational?: boolean
          provider_key: string
          schema_version?: number
          updated_at?: string
          webhook_config?: Json
        }
        Update: {
          adapter_contract_version?: number
          adapter_key?: string | null
          adapter_url?: string | null
          capabilities?: Json
          created_at?: string
          credential_schema?: Json
          display_name?: string
          execution_config?: Json
          id?: string
          is_active?: boolean
          is_custom_or_webhook_only?: boolean
          operational?: boolean
          provider_key?: string
          schema_version?: number
          updated_at?: string
          webhook_config?: Json
        }
        Relationships: []
      }
      gateway_recovery_queue: {
        Row: {
          attempt_id: string
          attempts: number
          created_at: string
          execution_logs: Json
          external_transaction_id: string | null
          failure_class: string
          gateway_id: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_retry_at: string
          provider: string
          recovery_state: Database["public"]["Enums"]["recovery_state"]
          state_version: number
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_id: string
          attempts?: number
          created_at?: string
          execution_logs?: Json
          external_transaction_id?: string | null
          failure_class: string
          gateway_id: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_retry_at?: string
          provider: string
          recovery_state?: Database["public"]["Enums"]["recovery_state"]
          state_version?: number
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_id?: string
          attempts?: number
          created_at?: string
          execution_logs?: Json
          external_transaction_id?: string | null
          failure_class?: string
          gateway_id?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_retry_at?: string
          provider?: string
          recovery_state?: Database["public"]["Enums"]["recovery_state"]
          state_version?: number
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gateway_refunds: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string
          currency: string
          external_refund_id: string | null
          failure_code: string | null
          failure_message: string | null
          gateway_id: string
          id: string
          idempotency_key: string
          metadata: Json
          status: string
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string
          currency: string
          external_refund_id?: string | null
          failure_code?: string | null
          failure_message?: string | null
          gateway_id: string
          id?: string
          idempotency_key: string
          metadata?: Json
          status: string
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          external_refund_id?: string | null
          failure_code?: string | null
          failure_message?: string | null
          gateway_id?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          status?: string
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_refunds_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_routes: {
        Row: {
          conditions: Json
          created_at: string
          enabled: boolean
          fallback_enabled: boolean
          funnel_id: string
          gateway_id: string
          id: string
          priority: number
          product_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conditions?: Json
          created_at?: string
          enabled?: boolean
          fallback_enabled?: boolean
          funnel_id: string
          gateway_id: string
          id?: string
          priority?: number
          product_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conditions?: Json
          created_at?: string
          enabled?: boolean
          fallback_enabled?: boolean
          funnel_id?: string
          gateway_id?: string
          id?: string
          priority?: number
          product_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_routes_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_routes_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "gateway_routes_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_routes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_routes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["product_id"]
          },
        ]
      }
      gateway_routing_overrides: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          expires_at: string
          forced_gateway_id: string
          funnel_id: string
          id: string
          reason: string
          starts_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          expires_at: string
          forced_gateway_id: string
          funnel_id: string
          id?: string
          reason: string
          starts_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          expires_at?: string
          forced_gateway_id?: string
          funnel_id?: string
          id?: string
          reason?: string
          starts_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_routing_overrides_forced_gateway_id_fkey"
            columns: ["forced_gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_routing_overrides_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_routing_overrides_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
      gateway_routing_policies: {
        Row: {
          created_at: string
          funnel_id: string
          id: string
          is_active: boolean
          name: string
          routing_graph: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          funnel_id: string
          id?: string
          is_active?: boolean
          name: string
          routing_graph: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          funnel_id?: string
          id?: string
          is_active?: boolean
          name?: string
          routing_graph?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      gateway_routing_rules: {
        Row: {
          created_at: string
          gateway_id: string | null
          gateway_name: string | null
          id: string
          is_active: boolean
          priority_order: number
          product_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gateway_id?: string | null
          gateway_name?: string | null
          id?: string
          is_active?: boolean
          priority_order: number
          product_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gateway_id?: string | null
          gateway_name?: string | null
          id?: string
          is_active?: boolean
          priority_order?: number
          product_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gateway_routing_split_policies: {
        Row: {
          active: boolean
          allocations: Json
          created_at: string
          created_by: string
          funnel_id: string
          id: string
          name: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active?: boolean
          allocations: Json
          created_at?: string
          created_by: string
          funnel_id: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          active?: boolean
          allocations?: Json
          created_at?: string
          created_by?: string
          funnel_id?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "gateway_routing_split_policies_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_routing_split_policies_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
      gateway_transactions: {
        Row: {
          amount: number
          attempt_count: number
          completed_at: string | null
          created_at: string
          currency: string
          customer: Json
          error_message: string | null
          external_id: string | null
          failure_code: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          product_id: string | null
          routing_metadata: Json
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          amount?: number
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer?: Json
          error_message?: string | null
          external_id?: string | null
          failure_code?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id: string
          product_id?: string | null
          routing_metadata?: Json
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          amount?: number
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer?: Json
          error_message?: string | null
          external_id?: string | null
          failure_code?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: string
          product_id?: string | null
          routing_metadata?: Json
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "gateway_transactions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_transactions_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "gateway_transactions_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["product_id"]
          },
        ]
      }
      gateway_webhook_events: {
        Row: {
          attempts: number
          gateway_id: string | null
          id: string
          last_error: string | null
          next_attempt_at: string | null
          payload: Json
          processed_at: string | null
          provider: string
          provider_event_id: string
          received_at: string
          signature_timestamp: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          gateway_id?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          processed_at?: string | null
          provider: string
          provider_event_id: string
          received_at?: string
          signature_timestamp: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          gateway_id?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_timestamp?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      gateway_webhook_secrets: {
        Row: {
          created_at: string
          gateway_id: string
          id: string
          is_active: boolean
          secret_ref: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gateway_id: string
          id?: string
          is_active?: boolean
          secret_ref: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gateway_id?: string
          id?: string
          is_active?: boolean
          secret_ref?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_webhook_secrets_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: true
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
        ]
      }
      gateways: {
        Row: {
          capabilities: Json
          circuit_id: string
          created_at: string | null
          credential_id: string | null
          data: Json | null
          display_name: string
          environment: string
          id: string
          organization_id: string
          provider: string
          status: string
          user_id: string
        }
        Insert: {
          capabilities?: Json
          circuit_id?: string
          created_at?: string | null
          credential_id?: string | null
          data?: Json | null
          display_name: string
          environment?: string
          id: string
          organization_id: string
          provider: string
          status?: string
          user_id: string
        }
        Update: {
          capabilities?: Json
          circuit_id?: string
          created_at?: string | null
          credential_id?: string | null
          data?: Json | null
          display_name?: string
          environment?: string
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateways_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "user_gateway_credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateways_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iara_anomalies: {
        Row: {
          anomaly_id: string
          baseline_mean: number
          baseline_sample_count: number
          baseline_stddev: number
          baseline_window_end: string
          baseline_window_start: string
          confidence: number
          created_at: string
          deduplication_key: string
          detection_method: string
          deviation: number
          entity_id: string | null
          entity_type: string | null
          evidence: Json
          execution_id: string | null
          first_observed_at: string
          last_observed_at: string
          metric: string
          observed_value: number
          occurrence_count: number
          severity: string
          status: string
          tenant_id: string
        }
        Insert: {
          anomaly_id?: string
          baseline_mean: number
          baseline_sample_count: number
          baseline_stddev: number
          baseline_window_end: string
          baseline_window_start: string
          confidence: number
          created_at?: string
          deduplication_key: string
          detection_method: string
          deviation: number
          entity_id?: string | null
          entity_type?: string | null
          evidence?: Json
          execution_id?: string | null
          first_observed_at: string
          last_observed_at: string
          metric: string
          observed_value: number
          occurrence_count?: number
          severity: string
          status?: string
          tenant_id: string
        }
        Update: {
          anomaly_id?: string
          baseline_mean?: number
          baseline_sample_count?: number
          baseline_stddev?: number
          baseline_window_end?: string
          baseline_window_start?: string
          confidence?: number
          created_at?: string
          deduplication_key?: string
          detection_method?: string
          deviation?: number
          entity_id?: string | null
          entity_type?: string | null
          evidence?: Json
          execution_id?: string | null
          first_observed_at?: string
          last_observed_at?: string
          metric?: string
          observed_value?: number
          occurrence_count?: number
          severity?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      iara_causal_diagnoses: {
        Row: {
          candidate_causes: Json
          causal_conclusion: string
          confidence: number
          confounders: Json
          counterfactual: string
          created_at: string
          diagnosis_id: string
          evidence_coverage: number
          execution_id: string | null
          limitations: Json
          metric: string
          observed_effect: number
          recommended_actions: Json
          tenant_id: string
        }
        Insert: {
          candidate_causes?: Json
          causal_conclusion: string
          confidence: number
          confounders?: Json
          counterfactual: string
          created_at?: string
          diagnosis_id: string
          evidence_coverage: number
          execution_id?: string | null
          limitations?: Json
          metric: string
          observed_effect: number
          recommended_actions?: Json
          tenant_id: string
        }
        Update: {
          candidate_causes?: Json
          causal_conclusion?: string
          confidence?: number
          confounders?: Json
          counterfactual?: string
          created_at?: string
          diagnosis_id?: string
          evidence_coverage?: number
          execution_id?: string | null
          limitations?: Json
          metric?: string
          observed_effect?: number
          recommended_actions?: Json
          tenant_id?: string
        }
        Relationships: []
      }
      iara_commercial_interventions: {
        Row: {
          assigned_agent_id: string | null
          checkout_id: string | null
          control_mode: string
          conversation_id: string
          created_at: string
          handed_off_at: string | null
          id: string
          last_customer_message_at: string | null
          metadata: Json
          state: string
          takeover_at: string | null
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_agent_id?: string | null
          checkout_id?: string | null
          control_mode?: string
          conversation_id: string
          created_at?: string
          handed_off_at?: string | null
          id?: string
          last_customer_message_at?: string | null
          metadata?: Json
          state?: string
          takeover_at?: string | null
          trigger_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_agent_id?: string | null
          checkout_id?: string | null
          control_mode?: string
          conversation_id?: string
          created_at?: string
          handed_off_at?: string | null
          id?: string
          last_customer_message_at?: string | null
          metadata?: Json
          state?: string
          takeover_at?: string | null
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_commercial_interventions_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "crm_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iara_commercial_interventions_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iara_commercial_interventions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "crm_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      iara_daily_reports: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivery_status: string
          evidence: Json
          generated_at: string
          id: string
          metrics: Json
          report_date: string
          report_text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string
          evidence?: Json
          generated_at?: string
          id?: string
          metrics?: Json
          report_date: string
          report_text: string
          user_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string
          evidence?: Json
          generated_at?: string
          id?: string
          metrics?: Json
          report_date?: string
          report_text?: string
          user_id?: string
        }
        Relationships: []
      }
      iara_evaluation_assertions: {
        Row: {
          assertion_id: string
          assertion_type: string
          created_at: string
          evaluation_id: string
          evidence: Json
          passed: boolean
          score: number
        }
        Insert: {
          assertion_id?: string
          assertion_type: string
          created_at?: string
          evaluation_id: string
          evidence?: Json
          passed: boolean
          score: number
        }
        Update: {
          assertion_id?: string
          assertion_type?: string
          created_at?: string
          evaluation_id?: string
          evidence?: Json
          passed?: boolean
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "iara_evaluation_assertions_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "iara_evaluations"
            referencedColumns: ["evaluation_id"]
          },
        ]
      }
      iara_evaluation_claims: {
        Row: {
          claim: string
          claim_id: string
          claim_type: string
          created_at: string
          evaluation_id: string
          evidence: Json
          freshness_seconds: number | null
          score: number
          verified: boolean
        }
        Insert: {
          claim: string
          claim_id?: string
          claim_type: string
          created_at?: string
          evaluation_id: string
          evidence?: Json
          freshness_seconds?: number | null
          score: number
          verified: boolean
        }
        Update: {
          claim?: string
          claim_id?: string
          claim_type?: string
          created_at?: string
          evaluation_id?: string
          evidence?: Json
          freshness_seconds?: number | null
          score?: number
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "iara_evaluation_claims_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "iara_evaluations"
            referencedColumns: ["evaluation_id"]
          },
        ]
      }
      iara_evaluation_failures: {
        Row: {
          created_at: string
          evaluation_id: string
          evidence: Json
          failure_code: string
          failure_id: string
          message: string
          severity: string
        }
        Insert: {
          created_at?: string
          evaluation_id: string
          evidence?: Json
          failure_code: string
          failure_id?: string
          message: string
          severity: string
        }
        Update: {
          created_at?: string
          evaluation_id?: string
          evidence?: Json
          failure_code?: string
          failure_id?: string
          message?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_evaluation_failures_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "iara_evaluations"
            referencedColumns: ["evaluation_id"]
          },
        ]
      }
      iara_evaluation_tool_calls: {
        Row: {
          authorized: boolean
          created_at: string
          evaluation_id: string
          observed_output: Json | null
          requested_input: Json
          result_valid: boolean
          schema_valid: boolean
          tool_call_id: string
          tool_key: string
        }
        Insert: {
          authorized: boolean
          created_at?: string
          evaluation_id: string
          observed_output?: Json | null
          requested_input?: Json
          result_valid: boolean
          schema_valid: boolean
          tool_call_id?: string
          tool_key: string
        }
        Update: {
          authorized?: boolean
          created_at?: string
          evaluation_id?: string
          observed_output?: Json | null
          requested_input?: Json
          result_valid?: boolean
          schema_valid?: boolean
          tool_call_id?: string
          tool_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_evaluation_tool_calls_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "iara_evaluations"
            referencedColumns: ["evaluation_id"]
          },
        ]
      }
      iara_evaluations: {
        Row: {
          causal_confidence: number
          created_at: string
          data_confidence: number
          decision: string
          evaluation_id: string
          evaluator_version: string
          evidence_coverage: number
          execution_id: string | null
          grounding_score: number
          hallucination_risk: number
          latency_ms: number | null
          overall_score: number
          summary: string
          tenant_id: string
          tool_call_accuracy: number
          total_cost_minor: number | null
        }
        Insert: {
          causal_confidence: number
          created_at?: string
          data_confidence: number
          decision: string
          evaluation_id?: string
          evaluator_version: string
          evidence_coverage: number
          execution_id?: string | null
          grounding_score: number
          hallucination_risk: number
          latency_ms?: number | null
          overall_score: number
          summary: string
          tenant_id: string
          tool_call_accuracy: number
          total_cost_minor?: number | null
        }
        Update: {
          causal_confidence?: number
          created_at?: string
          data_confidence?: number
          decision?: string
          evaluation_id?: string
          evaluator_version?: string
          evidence_coverage?: number
          execution_id?: string | null
          grounding_score?: number
          hallucination_risk?: number
          latency_ms?: number | null
          overall_score?: number
          summary?: string
          tenant_id?: string
          tool_call_accuracy?: number
          total_cost_minor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "iara_evaluations_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "crm_ai_actions"
            referencedColumns: ["execution_id"]
          },
        ]
      }
      iara_execution_idempotency: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          execution_id: string
          idempotency_id: string
          idempotency_key: string
          request_hash: string
          result: Json | null
          status: string
          tenant_id: string
          tool_key: string
          tool_version: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          execution_id: string
          idempotency_id?: string
          idempotency_key: string
          request_hash: string
          result?: Json | null
          status: string
          tenant_id: string
          tool_key: string
          tool_version: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          execution_id?: string
          idempotency_id?: string
          idempotency_key?: string
          request_hash?: string
          result?: Json | null
          status?: string
          tenant_id?: string
          tool_key?: string
          tool_version?: number
        }
        Relationships: []
      }
      iara_financial_confirmations: {
        Row: {
          action: string
          confirmation_id: string
          confirmed_at: string
          consumed_at: string | null
          expires_at: string
          gateway_id: string
          idempotency_key: string
          request_fingerprint: string
          tenant_id: string
          tool_key: string
          tool_version: number
          user_id: string
        }
        Insert: {
          action: string
          confirmation_id?: string
          confirmed_at?: string
          consumed_at?: string | null
          expires_at: string
          gateway_id: string
          idempotency_key: string
          request_fingerprint: string
          tenant_id: string
          tool_key: string
          tool_version: number
          user_id: string
        }
        Update: {
          action?: string
          confirmation_id?: string
          confirmed_at?: string
          consumed_at?: string | null
          expires_at?: string
          gateway_id?: string
          idempotency_key?: string
          request_fingerprint?: string
          tenant_id?: string
          tool_key?: string
          tool_version?: number
          user_id?: string
        }
        Relationships: []
      }
      iara_forecasts: {
        Row: {
          confidence: number
          created_at: string
          data_quality: number
          drivers: Json
          evidence_count: number
          execution_id: string | null
          forecast_id: string
          horizon: number
          limitations: Json
          metric: string
          model_version: string
          points: Json
          tenant_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          data_quality: number
          drivers?: Json
          evidence_count: number
          execution_id?: string | null
          forecast_id: string
          horizon: number
          limitations?: Json
          metric: string
          model_version: string
          points?: Json
          tenant_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          data_quality?: number
          drivers?: Json
          evidence_count?: number
          execution_id?: string | null
          forecast_id?: string
          horizon?: number
          limitations?: Json
          metric?: string
          model_version?: string
          points?: Json
          tenant_id?: string
        }
        Relationships: []
      }
      iara_funnel_drafts: {
        Row: {
          created_at: string
          funnel_id: string | null
          id: string
          prompt: string
          schema_version: number
          spec: Json
          status: string
          updated_at: string
          user_id: string
          validation: Json
        }
        Insert: {
          created_at?: string
          funnel_id?: string | null
          id?: string
          prompt: string
          schema_version?: number
          spec: Json
          status?: string
          updated_at?: string
          user_id: string
          validation?: Json
        }
        Update: {
          created_at?: string
          funnel_id?: string | null
          id?: string
          prompt?: string
          schema_version?: number
          spec?: Json
          status?: string
          updated_at?: string
          user_id?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "iara_funnel_drafts_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iara_funnel_drafts_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
      iara_funnel_runtime_specs: {
        Row: {
          created_at: string
          draft_id: string
          funnel_id: string
          id: string
          published_at: string
          spec: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          funnel_id: string
          id?: string
          published_at?: string
          spec: Json
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          funnel_id?: string
          id?: string
          published_at?: string
          spec?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_funnel_runtime_specs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "iara_funnel_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iara_funnel_runtime_specs_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: true
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iara_funnel_runtime_specs_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: true
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
      iara_memory_journal: {
        Row: {
          conversation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          execution_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          payload: Json
          product_id: string | null
          sequence_id: number
          session_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          execution_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          payload?: Json
          product_id?: string | null
          sequence_id: number
          session_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          execution_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          payload?: Json
          product_id?: string | null
          sequence_id?: number
          session_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_memory_journal_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      iara_memory_sequences: {
        Row: {
          next_sequence: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_sequence?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_sequence?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      iara_memory_snapshots: {
        Row: {
          created_at: string
          id: string
          sequence_id: number
          state: Json
          state_version: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sequence_id: number
          state: Json
          state_version?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          sequence_id?: number
          state?: Json
          state_version?: number
          tenant_id?: string
        }
        Relationships: []
      }
      iara_operational_telemetry: {
        Row: {
          created_at: string
          dimensions: Json
          entity_id: string | null
          entity_type: string | null
          id: string
          metric: string
          observed_at: string
          observed_value: number
          source_event_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          dimensions?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metric: string
          observed_at: string
          observed_value: number
          source_event_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          dimensions?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metric?: string
          observed_at?: string
          observed_value?: number
          source_event_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      iara_pix_invoices: {
        Row: {
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          discount_cents: number
          emv_payload: string
          expires_at: string
          final_amount_cents: number
          gateway_id: string | null
          id: string
          paid_at: string | null
          pix_key: string
          product_id: string
          provider_payment_id: string | null
          status: string
          transaction_id: string | null
          txid: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          client_id: string
          created_at?: string
          currency?: string
          discount_cents?: number
          emv_payload: string
          expires_at: string
          final_amount_cents: number
          gateway_id?: string | null
          id?: string
          paid_at?: string | null
          pix_key: string
          product_id: string
          provider_payment_id?: string | null
          status?: string
          transaction_id?: string | null
          txid: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          client_id?: string
          created_at?: string
          currency?: string
          discount_cents?: number
          emv_payload?: string
          expires_at?: string
          final_amount_cents?: number
          gateway_id?: string | null
          id?: string
          paid_at?: string | null
          pix_key?: string
          product_id?: string
          provider_payment_id?: string | null
          status?: string
          transaction_id?: string | null
          txid?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_pix_invoices_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      iara_pix_webhook_events: {
        Row: {
          event_id: string
          id: string
          payload: Json
          pix_invoice_id: string | null
          processed_at: string | null
          provider_payment_id: string | null
          received_at: string
          signature_verified: boolean
          user_id: string
        }
        Insert: {
          event_id: string
          id?: string
          payload?: Json
          pix_invoice_id?: string | null
          processed_at?: string | null
          provider_payment_id?: string | null
          received_at?: string
          signature_verified?: boolean
          user_id: string
        }
        Update: {
          event_id?: string
          id?: string
          payload?: Json
          pix_invoice_id?: string | null
          processed_at?: string | null
          provider_payment_id?: string | null
          received_at?: string
          signature_verified?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_pix_webhook_events_pix_invoice_id_fkey"
            columns: ["pix_invoice_id"]
            isOneToOne: false
            referencedRelation: "iara_pix_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      iara_proactive_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_id: string
          category: string
          created_at: string
          deduplication_key: string
          estimated_impact: number | null
          evidence: Json
          execution_id: string | null
          explanation: string
          first_observed_at: string
          funnel_id: string | null
          gateway_id: string | null
          headline: string
          impact_confidence: number | null
          last_observed_at: string
          occurrence_count: number
          policy_state: string
          product_id: string | null
          recommended_actions: Json
          resolved_at: string | null
          severity: string
          source_id: string | null
          source_type: string
          status: string
          tenant_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          alert_id?: string
          category: string
          created_at?: string
          deduplication_key: string
          estimated_impact?: number | null
          evidence?: Json
          execution_id?: string | null
          explanation: string
          first_observed_at: string
          funnel_id?: string | null
          gateway_id?: string | null
          headline: string
          impact_confidence?: number | null
          last_observed_at: string
          occurrence_count?: number
          policy_state?: string
          product_id?: string | null
          recommended_actions?: Json
          resolved_at?: string | null
          severity: string
          source_id?: string | null
          source_type: string
          status?: string
          tenant_id: string
        }
        Update: {
          acknowledged_at?: string | null
          alert_id?: string
          category?: string
          created_at?: string
          deduplication_key?: string
          estimated_impact?: number | null
          evidence?: Json
          execution_id?: string | null
          explanation?: string
          first_observed_at?: string
          funnel_id?: string | null
          gateway_id?: string | null
          headline?: string
          impact_confidence?: number | null
          last_observed_at?: string
          occurrence_count?: number
          policy_state?: string
          product_id?: string | null
          recommended_actions?: Json
          resolved_at?: string | null
          severity?: string
          source_id?: string | null
          source_type?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      iara_queue_dead_letters: {
        Row: {
          attempts_made: number
          error_code: string | null
          error_message: string | null
          id: string
          job_id: string
          payload: Json
          quarantined_at: string
          queue_type: string
          tenant_id: string
        }
        Insert: {
          attempts_made: number
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          payload: Json
          quarantined_at?: string
          queue_type: string
          tenant_id: string
        }
        Update: {
          attempts_made?: number
          error_code?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          payload?: Json
          quarantined_at?: string
          queue_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_queue_dead_letters_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "iara_queue_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      iara_queue_jobs: {
        Row: {
          attempts_made: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          max_attempts: number
          payload: Json
          queue_type: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts_made?: number
          completed_at?: string | null
          created_at?: string
          id: string
          idempotency_key: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          payload?: Json
          queue_type: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts_made?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          payload?: Json
          queue_type?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      iara_runs: {
        Row: {
          client_request_id: string | null
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          latency_ms: number | null
          model: string | null
          session_id: string
          status: string
          tool_count: number
          user_id: string
        }
        Insert: {
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          session_id: string
          status: string
          tool_count?: number
          user_id: string
        }
        Update: {
          client_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          session_id?: string
          status?: string
          tool_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iara_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          lease_token: string | null
          lease_version: number
          organization_id: string
          request_digest: string | null
          resource_id: string | null
          resource_type: string | null
          response_code: number | null
          response_digest: string | null
          response_payload: Json | null
          scope: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          lease_token?: string | null
          lease_version?: number
          organization_id: string
          request_digest?: string | null
          resource_id?: string | null
          resource_type?: string | null
          response_code?: number | null
          response_digest?: string | null
          response_payload?: Json | null
          scope: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          lease_token?: string | null
          lease_version?: number
          organization_id?: string
          request_digest?: string | null
          resource_id?: string | null
          resource_type?: string | null
          response_code?: number | null
          response_digest?: string | null
          response_payload?: Json | null
          scope?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          claim_attempt: number
          claimed_at: string | null
          created_at: string
          error_message: string | null
          event_key: string | null
          event_type: string
          external_id: string | null
          funnel_id: string | null
          id: string
          integration_id: string | null
          next_retry_at: string | null
          occurred_at: string
          organization_id: string
          payload: Json
          processed_at: string | null
          retry_count: number | null
          status: string
          user_id: string
        }
        Insert: {
          claim_attempt?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          event_key?: string | null
          event_type: string
          external_id?: string | null
          funnel_id?: string | null
          id?: string
          integration_id?: string | null
          next_retry_at?: string | null
          occurred_at?: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
          retry_count?: number | null
          status?: string
          user_id: string
        }
        Update: {
          claim_attempt?: number
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          event_key?: string | null
          event_type?: string
          external_id?: string | null
          funnel_id?: string | null
          id?: string
          integration_id?: string | null
          next_retry_at?: string | null
          occurred_at?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          retry_count?: number | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "webhook_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      logs: {
        Row: {
          action: string | null
          created_at: string | null
          details: string | null
          id: string
          resource: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          details?: string | null
          id: string
          resource?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          details?: string | null
          id?: string
          resource?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      merchant_business_profiles: {
        Row: {
          created_at: string
          document_number: string | null
          document_type: string
          legal_name: string | null
          operation_metadata: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_number?: string | null
          document_type?: string
          legal_name?: string | null
          operation_metadata?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_number?: string | null
          document_type?: string
          legal_name?: string | null
          operation_metadata?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      merchant_risk: {
        Row: {
          created_at: string
          metadata: Json
          review_status: string
          reviewed_at: string | null
          risk_level: string
          risk_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          metadata?: Json
          review_status?: string
          reviewed_at?: string | null
          risk_level?: string
          risk_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          metadata?: Json
          review_status?: string
          reviewed_at?: string | null
          risk_level?: string
          risk_score?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      outbound_webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          delivered_at: string | null
          error_message: string | null
          event_id: string | null
          event_type: string
          id: string
          idempotency_key: string
          next_retry_at: string | null
          payload: Json
          response_code: number | null
          response_time_ms: number | null
          status: string
          user_id: string
          webhook_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          event_id?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          next_retry_at?: string | null
          payload: Json
          response_code?: number | null
          response_time_ms?: number | null
          status?: string
          user_id: string
          webhook_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          event_id?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          next_retry_at?: string | null
          payload?: Json
          response_code?: number | null
          response_time_ms?: number | null
          status?: string
          user_id?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "outbound_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_webhooks: {
        Row: {
          created_at: string
          endpoint_url: string
          events: string[]
          id: string
          max_attempts: number
          name: string
          secret_hash: string | null
          secret_ref: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint_url: string
          events?: string[]
          id?: string
          max_attempts?: number
          name: string
          secret_hash?: string | null
          secret_ref?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint_url?: string
          events?: string[]
          id?: string
          max_attempts?: number
          name?: string
          secret_hash?: string | null
          secret_ref?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pix_configs: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      pix_history: {
        Row: {
          created_at: string | null
          data: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      platform_api_credentials: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_revealed_at: string | null
          updated_at: string
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_revealed_at?: string | null
          updated_at?: string
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_revealed_at?: string | null
          updated_at?: string
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      platform_health_checks: {
        Row: {
          check_name: string
          checked_at: string
          details: Json
          id: string
          status: string
        }
        Insert: {
          check_name: string
          checked_at?: string
          details?: Json
          id?: string
          status: string
        }
        Update: {
          check_name?: string
          checked_at?: string
          details?: Json
          id?: string
          status?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      production_readiness_gates: {
        Row: {
          evidence: Json
          gate_name: string
          required: boolean
          status: string
          updated_at: string
        }
        Insert: {
          evidence?: Json
          gate_name: string
          required?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          evidence?: Json
          gate_name?: string
          required?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          billing_interval: string | null
          billing_type: string
          created_at: string | null
          currency: string
          data: Json | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          interval_count: number | null
          metadata: Json
          name: string | null
          organization_id: string
          product_type: string | null
          sku: string | null
          slug: string | null
          status: string
          unit_amount: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          billing_interval?: string | null
          billing_type?: string
          created_at?: string | null
          currency?: string
          data?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id: string
          interval_count?: number | null
          metadata?: Json
          name?: string | null
          organization_id: string
          product_type?: string | null
          sku?: string | null
          slug?: string | null
          status?: string
          unit_amount?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          billing_interval?: string | null
          billing_type?: string
          created_at?: string | null
          currency?: string
          data?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          interval_count?: number | null
          metadata?: Json
          name?: string | null
          organization_id?: string
          product_type?: string | null
          sku?: string | null
          slug?: string | null
          status?: string
          unit_amount?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_organization_id: string | null
          display_name: string | null
          full_name: string | null
          gender: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_organization_id?: string | null
          display_name?: string | null
          full_name?: string | null
          gender?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_organization_id?: string | null
          display_name?: string | null
          full_name?: string | null
          gender?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_organization_id_fkey"
            columns: ["default_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_items: {
        Row: {
          created_at: string
          discrepancy_amount: number | null
          expected_amount: number | null
          external_transaction_id: string | null
          gateway_payload: Json
          id: string
          metadata: Json
          mismatch_reason: string | null
          organization_id: string
          provider_event_id: string | null
          provider_fee: number | null
          reported_amount: number | null
          run_id: string
          settled_at: string | null
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discrepancy_amount?: number | null
          expected_amount?: number | null
          external_transaction_id?: string | null
          gateway_payload?: Json
          id?: string
          metadata?: Json
          mismatch_reason?: string | null
          organization_id: string
          provider_event_id?: string | null
          provider_fee?: number | null
          reported_amount?: number | null
          run_id: string
          settled_at?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          discrepancy_amount?: number | null
          expected_amount?: number | null
          external_transaction_id?: string | null
          gateway_payload?: Json
          id?: string
          metadata?: Json
          mismatch_reason?: string | null
          organization_id?: string
          provider_event_id?: string | null
          provider_fee?: number | null
          reported_amount?: number | null
          run_id?: string
          settled_at?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_run_tenant_fk"
            columns: ["run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "reconciliation_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          discrepancy_amount: number
          error_message: string | null
          fees_expected: number
          fees_reported: number
          gateway_id: string | null
          gross_expected: number
          gross_reported: number
          id: string
          matched_count: number
          mismatch_count: number
          net_expected: number
          net_reported: number
          organization_id: string
          period_end: string
          period_start: string
          source_reference: string | null
          source_type: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          discrepancy_amount?: number
          error_message?: string | null
          fees_expected?: number
          fees_reported?: number
          gateway_id?: string | null
          gross_expected?: number
          gross_reported?: number
          id?: string
          matched_count?: number
          mismatch_count?: number
          net_expected?: number
          net_reported?: number
          organization_id: string
          period_end: string
          period_start: string
          source_reference?: string | null
          source_type?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          discrepancy_amount?: number
          error_message?: string | null
          fees_expected?: number
          fees_reported?: number
          gateway_id?: string | null
          gross_expected?: number
          gross_reported?: number
          id?: string
          matched_count?: number
          mismatch_count?: number
          net_expected?: number
          net_reported?: number
          organization_id?: string
          period_end?: string
          period_start?: string
          source_reference?: string | null
          source_type?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_runs_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_events: {
        Row: {
          checkout_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          checkout_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          checkout_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_events_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_assessments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          decision: string
          external_reference: string | null
          id: string
          provider: string
          reason_codes: Json
          risk_level: string
          risk_score: number | null
          signals: Json
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          decision: string
          external_reference?: string | null
          id?: string
          provider: string
          reason_codes?: Json
          risk_level: string
          risk_score?: number | null
          signals?: Json
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          decision?: string
          external_reference?: string | null
          id?: string
          provider?: string
          reason_codes?: Json
          risk_level?: string
          risk_score?: number | null
          signals?: Json
          user_id?: string
        }
        Relationships: []
      }
      sales: {
        Row: {
          amount: number | null
          attribution: Json | null
          campaign: string | null
          checkout_id: string | null
          click_id: string | null
          content: string | null
          created_at: string | null
          currency: string | null
          data: Json | null
          external_id: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          medium: string | null
          occurred_at: string | null
          organization_id: string
          product_id: string | null
          source: string | null
          status: string | null
          term: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          attribution?: Json | null
          campaign?: string | null
          checkout_id?: string | null
          click_id?: string | null
          content?: string | null
          created_at?: string | null
          currency?: string | null
          data?: Json | null
          external_id?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id: string
          medium?: string | null
          occurred_at?: string | null
          organization_id: string
          product_id?: string | null
          source?: string | null
          status?: string | null
          term?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          attribution?: Json | null
          campaign?: string | null
          checkout_id?: string | null
          click_id?: string | null
          content?: string | null
          created_at?: string | null
          currency?: string | null
          data?: Json | null
          external_id?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id?: string
          medium?: string | null
          occurred_at?: string | null
          organization_id?: string
          product_id?: string | null
          source?: string | null
          status?: string | null
          term?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          created_at: string
          currency: string
          discrepancy_amount: number | null
          external_settlement_id: string | null
          fees_total: number
          gateway_id: string
          gross_total: number
          id: string
          metadata: Json
          net_total: number
          organization_id: string
          period_end: string | null
          period_start: string | null
          reconciled_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          discrepancy_amount?: number | null
          external_settlement_id?: string | null
          fees_total?: number
          gateway_id: string
          gross_total?: number
          id?: string
          metadata?: Json
          net_total?: number
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          reconciled_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          discrepancy_amount?: number | null
          external_settlement_id?: string | null
          fees_total?: number
          gateway_id?: string
          gross_total?: number
          id?: string
          metadata?: Json
          net_total?: number
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          reconciled_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          event_type: string
          from_status: string | null
          id: string
          metadata: Json
          occurred_at: string
          provider_event_id: string | null
          subscription_id: string
          to_status: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          provider_event_id?: string | null
          subscription_id: string
          to_status?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          provider_event_id?: string | null
          subscription_id?: string
          to_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number
          billing_interval: string
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          customer_id: string | null
          ended_at: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          interval_count: number
          metadata: Json
          next_billing_at: string | null
          product_id: string | null
          provider_subscription_id: string | null
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          billing_interval?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id?: string | null
          ended_at?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id?: string
          interval_count?: number
          metadata?: Json
          next_billing_at?: string | null
          product_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          billing_interval?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id?: string | null
          ended_at?: string | null
          funnel_id?: string | null
          gateway_id?: string | null
          id?: string
          interval_count?: number
          metadata?: Json
          next_billing_at?: string | null
          product_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_customer_tenant_fk"
            columns: ["user_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "subscriptions_funnel_fk"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_funnel_fk"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
          {
            foreignKeyName: "subscriptions_gateway_fk"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "subscriptions_transaction_fk"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "gateway_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      team_funnel_access: {
        Row: {
          access_level: string
          created_at: string
          funnel_id: string
          user_id: string
        }
        Insert: {
          access_level?: string
          created_at?: string
          funnel_id: string
          user_id: string
        }
        Update: {
          access_level?: string
          created_at?: string
          funnel_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_funnel_access_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_funnel_access_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
      transaction_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string | null
          source: string
          status: string
          transaction_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: string | null
          source?: string
          status?: string
          transaction_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          organization_id?: string | null
          source?: string
          status?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_routing_logs: {
        Row: {
          amount: number
          card_brand: string | null
          completed_at: string | null
          created_at: string
          currency: string
          failure_class: string | null
          final_gateway: string | null
          gateways_attempted: Json
          id: string
          idempotency_key: string | null
          sale_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          card_brand?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          failure_class?: string | null
          final_gateway?: string | null
          gateways_attempted?: Json
          id?: string
          idempotency_key?: string | null
          sale_id?: string | null
          status: string
          user_id: string
        }
        Update: {
          amount?: number
          card_brand?: string | null
          completed_at?: string | null
          created_at?: string
          currency?: string
          failure_class?: string | null
          final_gateway?: string | null
          gateways_attempted?: Json
          id?: string
          idempotency_key?: string | null
          sale_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      user_gateway_credentials: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          gateway_name: string
          id: string
          is_active: boolean
          metadata: Json
          organization_id: string
          priority_order: number
          secret_ref: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          gateway_name: string
          id?: string
          is_active?: boolean
          metadata?: Json
          organization_id: string
          priority_order?: number
          secret_ref?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          gateway_name?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          organization_id?: string
          priority_order?: number
          secret_ref?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_gateway_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_status: {
        Row: {
          created_at: string
          expires_at: string | null
          external_reference: string | null
          metadata: Json
          provider: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          external_reference?: string | null
          metadata?: Json
          provider?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          external_reference?: string | null
          metadata?: Json
          provider?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          delivered_at: string | null
          endpoint: string | null
          error_message: string | null
          event_type: string
          id: string
          integration_id: string | null
          payload: Json
          response_code: number | null
          response_time_ms: number | null
          signature_valid: boolean
          status: string
          user_id: string | null
        }
        Insert: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          endpoint?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          integration_id?: string | null
          payload?: Json
          response_code?: number | null
          response_time_ms?: number | null
          signature_valid?: boolean
          status?: string
          user_id?: string | null
        }
        Update: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          endpoint?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          integration_id?: string | null
          payload?: Json
          response_code?: number | null
          response_time_ms?: number | null
          signature_valid?: boolean
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      webhook_integrations: {
        Row: {
          created_at: string
          endpoint_key: string
          event_count: number
          funnel_id: string | null
          id: string
          last_event_at: string | null
          last_used_at: string | null
          name: string
          organization_id: string
          provider: string
          secret: string | null
          secret_hash: string
          secret_prefix: string | null
          status: string
          updated_at: string
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint_key: string
          event_count?: number
          funnel_id?: string | null
          id?: string
          last_event_at?: string | null
          last_used_at?: string | null
          name: string
          organization_id: string
          provider?: string
          secret?: string | null
          secret_hash: string
          secret_prefix?: string | null
          status?: string
          updated_at?: string
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint_key?: string
          event_count?: number
          funnel_id?: string | null
          id?: string
          last_event_at?: string | null
          last_used_at?: string | null
          name?: string
          organization_id?: string
          provider?: string
          secret?: string | null
          secret_hash?: string
          secret_prefix?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_integrations_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_integrations_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_commercial_context"
            referencedColumns: ["funnel_id"]
          },
        ]
      }
    }
    Views: {
      core_job_dlq: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string | null
          attempts: number | null
          created_at: string | null
          id: string | null
          job_type: string | null
          last_error: string | null
          max_attempts: number | null
          payload: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type?: string | null
          attempts?: number | null
          created_at?: string | null
          id?: string | null
          job_type?: string | null
          last_error?: string | null
          max_attempts?: number | null
          payload?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string | null
          attempts?: number | null
          created_at?: string | null
          id?: string | null
          job_type?: string | null
          last_error?: string | null
          max_attempts?: number | null
          payload?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      v_funnel_commercial_context: {
        Row: {
          event_endpoint: string | null
          external_url: string | null
          funnel_id: string | null
          funnel_name: string | null
          funnel_status: string | null
          funnel_type: string | null
          gateway_binding_id: string | null
          gateway_binding_status: string | null
          gateway_environment: string | null
          gateway_id: string | null
          gateway_is_primary: boolean | null
          gateway_name: string | null
          gateway_priority: number | null
          gateway_provider: string | null
          gateway_role: string | null
          gateway_status: string | null
          offer_currency: string | null
          offer_id: string | null
          offer_name: string | null
          offer_price: number | null
          offer_status: string | null
          offer_type: string | null
          organization_id: string | null
          product_currency: string | null
          product_id: string | null
          product_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_gateway_bindings_gateway_id_fkey"
            columns: ["gateway_id"]
            isOneToOne: false
            referencedRelation: "gateways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_gateway_circuit: {
        Args: {
          p_cooldown_seconds?: number
          p_failure_threshold?: number
          p_gateway_id: string
          p_gateway_name: string
          p_probe_lease_seconds?: number
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          circuit_state: string
          failure_count: number
          probe_token: string
        }[]
      }
      add_funnel_step: {
        Args: {
          p_config?: Json
          p_funnel_id: string
          p_name: string
          p_step_type: string
        }
        Returns: {
          config: Json
          created_at: string
          funnel_id: string
          id: string
          name: string
          organization_id: string
          position: number
          status: string
          step_key: string
          step_type: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "funnel_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      allocate_and_insert_gateway_payment_attempt: {
        Args: {
          p_decision_reason?: string
          p_duration_ms?: number
          p_external_transaction_id?: string
          p_failure_class?: string
          p_gateway_id: string
          p_gateway_name: string
          p_idempotency_key: string
          p_product_id?: string
          p_provider_request_id?: string
          p_routing_policy_id?: string
          p_routing_policy_version?: number
          p_routing_rule_id?: string
          p_sale_id?: string
          p_status?: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: {
          attempt_order: number
          completed_at: string | null
          created_at: string
          decision_reason: string | null
          duration_ms: number | null
          error_message: string | null
          external_transaction_id: string | null
          failure_class: string | null
          gateway_id: string | null
          gateway_name: string
          id: string
          idempotency_key: string
          organization_id: string
          product_id: string | null
          provider_request_id: string | null
          response_code: string | null
          routing_policy_id: string | null
          routing_policy_version: number | null
          routing_rule_id: string | null
          sale_id: string | null
          status: string
          transaction_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "gateway_payment_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      althea_gateway_encryption_key: { Args: never; Returns: string }
      althea_pay_calculate_tmr: {
        Args: { target_user_id: string }
        Returns: number
      }
      archive_product: {
        Args: { p_product_id: string; p_version: number }
        Returns: {
          billing_interval: string | null
          billing_type: string
          created_at: string | null
          currency: string
          data: Json | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          interval_count: number | null
          metadata: Json
          name: string | null
          organization_id: string
          product_type: string | null
          sku: string | null
          slug: string | null
          status: string
          unit_amount: number
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_canonical_gateway_reference: {
        Args: { p_graph: Json }
        Returns: undefined
      }
      assign_funnel_offer_step: {
        Args: { p_offer_id: string; p_step_id: string }
        Returns: {
          config: Json
          created_at: string
          currency: string
          funnel_id: string
          id: string
          name: string
          offer_type: string
          organization_id: string
          price: number
          product_id: string
          status: string
          step_id: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "funnel_offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      authenticate_althea_api_key: {
        Args: { p_key: string }
        Returns: {
          api_key_id: string
          expires_at: string
          scopes: Json
          user_id: string
        }[]
      }
      bind_funnel_gateway: {
        Args: {
          p_funnel_id: string
          p_gateway_id: string
          p_make_primary?: boolean
          p_priority?: number
          p_role?: string
        }
        Returns: Json
      }
      bind_funnel_product: {
        Args: {
          p_currency?: string
          p_funnel_id: string
          p_offer_name?: string
          p_price?: number
          p_product_id: string
        }
        Returns: Json
      }
      bind_gateway_transaction_gateway: {
        Args: {
          p_expected_version: number
          p_gateway_id: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: {
          amount: number
          attempt_count: number
          completed_at: string | null
          created_at: string
          currency: string
          customer: Json
          error_message: string | null
          external_id: string | null
          failure_code: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          product_id: string | null
          routing_metadata: Json
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "gateway_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      build_dispute_evidence_bundle: {
        Args: { p_dispute_id: string }
        Returns: Json
      }
      can_failover_payment: {
        Args: { p_failure_class: string }
        Returns: boolean
      }
      can_run_reconciliation: { Args: never; Returns: boolean }
      check_althea_api_rate_limit: {
        Args: { p_key_id: string; p_limit?: number; p_window_seconds?: number }
        Returns: boolean
      }
      check_checkout_inactivity: { Args: never; Returns: number }
      claim_core_jobs: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          aggregate_id: string | null
          aggregate_type: string | null
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "core_job_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_gateway_payment_link_execution: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          action: string
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          gateway_id: string
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          locked_at: string | null
          locked_by: string | null
          payment_link_id: string
          request_payload: Json
          result_payload: Json | null
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "gateway_payment_link_execution_commands"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_gateway_recovery_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_id: string
          attempts: number
          created_at: string
          execution_logs: Json
          external_transaction_id: string | null
          failure_class: string
          gateway_id: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_retry_at: string
          provider: string
          recovery_state: Database["public"]["Enums"]["recovery_state"]
          state_version: number
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "gateway_recovery_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_integration_event: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      cleanup_althea_api_rate_limits: { Args: never; Returns: undefined }
      cleanup_gateway_e2e_orphan_traces: { Args: never; Returns: number }
      clear_gateway_routing_override: {
        Args: { p_funnel_id: string }
        Returns: boolean
      }
      complete_gateway_payment_link: {
        Args: {
          p_expires_at?: string
          p_external_id?: string
          p_link_id: string
          p_metadata?: Json
          p_payment_url?: string
          p_pix_copy_paste?: string
          p_qr_code_base64?: string
          p_status: string
          p_user_id: string
        }
        Returns: Json
      }
      complete_gateway_payment_link_execution: {
        Args: { p_command_id: string; p_result_payload: Json }
        Returns: Json
      }
      complete_idempotency_key: {
        Args: {
          p_id: string
          p_lease_token?: string
          p_resource_id?: string
          p_resource_type?: string
          p_response_code: number
          p_response_payload: Json
          p_status: string
        }
        Returns: boolean
      }
      configure_funnel_checkout_step: {
        Args: {
          p_offer_id: string
          p_payment_methods?: Json
          p_step_id: string
        }
        Returns: {
          config: Json
          created_at: string
          funnel_id: string
          id: string
          name: string
          organization_id: string
          position: number
          status: string
          step_key: string
          step_type: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "funnel_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_althea_api_rate_limit: {
        Args: { p_api_key_id: string; p_limit?: number }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      create_gateway_payment_instrument: {
        Args: {
          p_brand?: string
          p_customer_ref: string
          p_instrument_fingerprint?: string
          p_last4?: string
        }
        Returns: string
      }
      create_gateway_transaction: {
        Args: {
          p_amount: number
          p_currency: string
          p_customer: Json
          p_funnel_id: string
          p_idempotency_key: string
          p_metadata: Json
          p_organization_id: string
          p_product_id: string
          p_user_id: string
        }
        Returns: {
          amount: number
          attempt_count: number
          completed_at: string | null
          created_at: string
          currency: string
          customer: Json
          error_message: string | null
          external_id: string | null
          failure_code: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          product_id: string | null
          routing_metadata: Json
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "gateway_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_iara_pix_invoice: {
        Args: {
          p_amount_cents: number
          p_client_id: string
          p_discount_cents: number
          p_emv_payload: string
          p_expires_at: string
          p_gateway_id: string
          p_pix_key: string
          p_product_id: string
          p_transaction_id: string
          p_txid: string
          p_user_id: string
        }
        Returns: {
          amount_cents: number
          client_id: string
          created_at: string
          currency: string
          discount_cents: number
          emv_payload: string
          expires_at: string
          final_amount_cents: number
          gateway_id: string | null
          id: string
          paid_at: string | null
          pix_key: string
          product_id: string
          provider_payment_id: string | null
          status: string
          transaction_id: string | null
          txid: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "iara_pix_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization_for_current_user: {
        Args: { p_name: string; p_slug?: string }
        Returns: string
      }
      create_product: {
        Args: {
          p_billing_interval?: string
          p_billing_type?: string
          p_currency?: string
          p_description?: string
          p_interval_count?: number
          p_metadata?: Json
          p_name: string
          p_product_type?: string
          p_sku?: string
          p_slug?: string
          p_unit_amount?: number
        }
        Returns: {
          billing_interval: string | null
          billing_type: string
          created_at: string | null
          currency: string
          data: Json | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          interval_count: number | null
          metadata: Json
          name: string | null
          organization_id: string
          product_type: string | null
          sku: string | null
          slug: string | null
          status: string
          unit_amount: number
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_public_checkout_session: {
        Args: {
          p_attribution?: Json
          p_customer?: Json
          p_funnel_id: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_offer_id: string
        }
        Returns: Json
      }
      crm_analytics: { Args: { p_days?: number }; Returns: Json }
      crm_assign_conversation: {
        Args: {
          p_agent_id?: string
          p_conversation_id: string
          p_priority?: string
          p_team_id?: string
        }
        Returns: Json
      }
      crm_cancel_automation_execution: {
        Args: { p_execution_id: string; p_reason?: string }
        Returns: {
          action_type: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          error_message: string | null
          event_id: string | null
          execution_key: string
          id: string
          input: Json
          max_attempts: number
          next_retry_at: string | null
          output: Json
          replay_count: number
          replayed_at: string | null
          rule_id: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "automation_executions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_capture_predictive_outcomes: {
        Args: { p_model_version?: string }
        Returns: number
      }
      crm_check_automation_rate_limit: {
        Args: {
          p_limit?: number
          p_rule_id: string
          p_user_id: string
          p_window_seconds?: number
        }
        Returns: boolean
      }
      crm_claim_ai_action: {
        Args: { p_action_id: string }
        Returns: {
          action_type: string
          conversation_id: string | null
          created_at: string
          executed_at: string | null
          executing_at: string | null
          execution_id: string | null
          execution_message_id: string | null
          execution_provenance: Json
          id: string
          idempotency_key: string | null
          payload: Json
          rationale: string
          score: number
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_ai_actions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_claim_automation_retries: {
        Args: { p_limit?: number }
        Returns: {
          action_type: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          error_message: string | null
          event_id: string | null
          execution_key: string
          id: string
          input: Json
          max_attempts: number
          next_retry_at: string | null
          output: Json
          replay_count: number
          replayed_at: string | null
          rule_id: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "automation_executions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crm_claim_channel_outbox_worker: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body: string
          channel: string
          channel_account_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string
          external_message_id: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          metadata: Json
          next_attempt_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_channel_message_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crm_claim_scheduled_automation_executions: {
        Args: { p_limit?: number }
        Returns: {
          action_type: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          error_message: string | null
          event_id: string | null
          execution_key: string
          id: string
          input: Json
          max_attempts: number
          next_retry_at: string | null
          output: Json
          replay_count: number
          replayed_at: string | null
          rule_id: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "automation_executions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crm_complete_task: { Args: { p_task_id: string }; Returns: Json }
      crm_conversation_sla: {
        Args: { p_conversation_id: string }
        Returns: {
          conversation_id: string
          first_response_at: string
          first_response_due_at: string
          last_inbound_at: string
          priority: string
          queue_entered_at: string
          response_seconds: number
          sla_breached_at: string
          sla_state: string
        }[]
      }
      crm_customer_360: { Args: { p_conversation_id: string }; Returns: Json }
      crm_execute_ai_action: {
        Args: { p_action_id: string; p_body: string }
        Returns: Json
      }
      crm_experiment_assign: {
        Args: {
          p_conversation_id?: string
          p_experiment_id: string
          p_subject_key: string
        }
        Returns: Json
      }
      crm_experiment_guardrail_status: {
        Args: { p_experiment_id: string }
        Returns: Json
      }
      crm_experiment_power: {
        Args: {
          p_alpha?: number
          p_baseline: number
          p_mde?: number
          p_power?: number
        }
        Returns: Json
      }
      crm_experiment_promote_winner: {
        Args: {
          p_experiment_id: string
          p_reason?: string
          p_variant_id: string
        }
        Returns: Json
      }
      crm_experiment_record_outcome: {
        Args: { p_exposure_id: string; p_outcome: string; p_value?: number }
        Returns: string
      }
      crm_experiment_report: {
        Args: { p_experiment_id: string }
        Returns: Json
      }
      crm_experiment_sample_size_binary: {
        Args: {
          p_alpha?: number
          p_baseline?: number
          p_mde?: number
          p_power?: number
        }
        Returns: number
      }
      crm_ingest_channel_message: {
        Args: {
          p_body: string
          p_channel: string
          p_channel_account_id: string
          p_display_name?: string
          p_email?: string
          p_external_message_id: string
          p_external_user_id: string
          p_metadata?: Json
          p_phone_e164?: string
          p_user_id: string
        }
        Returns: Json
      }
      crm_mark_automation_dead_letter: {
        Args: { p_error: string; p_execution_id: string }
        Returns: {
          action_type: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          error_message: string | null
          event_id: string | null
          execution_key: string
          id: string
          input: Json
          max_attempts: number
          next_retry_at: string | null
          output: Json
          replay_count: number
          replayed_at: string | null
          rule_id: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "automation_executions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_multicrm_conversations_page: {
        Args: {
          p_agent_id?: string
          p_cursor_id?: string
          p_cursor_updated_at?: string
          p_filter?: string
          p_limit?: number
          p_priority?: string
          p_query?: string
          p_team_id?: string
        }
        Returns: Json
      }
      crm_multicrm_messages_page: {
        Args: {
          p_conversation_id: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
        }
        Returns: Json
      }
      crm_next_best_action: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      crm_next_best_actions: {
        Args: { p_conversation_id?: string }
        Returns: {
          action_type: string
          evidence: Json
          priority: number
          rationale: string
          score: number
        }[]
      }
      crm_operator_mark_read: {
        Args: { p_conversation_id: string }
        Returns: {
          assigned_to: string | null
          buyer_email: string | null
          buyer_name: string | null
          channel_account_id: string | null
          checkout_status: Database["public"]["Enums"]["lead_checkout_status"]
          created_at: string
          customer_id: string | null
          customer_whatsapp: string | null
          first_response_at: string | null
          first_response_due_at: string | null
          funnel_id: string | null
          gateway_error_log: string | null
          id: string
          last_activity_at: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_direction: string | null
          metadata: Json
          primary_channel: string
          priority: string
          product_id: string | null
          public_token: string | null
          queue_entered_at: string | null
          quiz_answers: Json
          sla_breached_at: string | null
          status: string
          transaction_id: string | null
          unread_count: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_operator_prepare_checkout_recovery: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      crm_operator_send_message: {
        Args: {
          p_body: string
          p_client_message_id?: string
          p_conversation_id: string
        }
        Returns: {
          body: string
          channel: string
          channel_account_id: string | null
          client_message_id: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: string
          external_message_id: string | null
          id: string
          metadata: Json
          provider: string
          sender_id: string | null
          sender_name: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_operator_set_status: {
        Args: { p_conversation_id: string; p_status: string }
        Returns: {
          assigned_to: string | null
          buyer_email: string | null
          buyer_name: string | null
          channel_account_id: string | null
          checkout_status: Database["public"]["Enums"]["lead_checkout_status"]
          created_at: string
          customer_id: string | null
          customer_whatsapp: string | null
          first_response_at: string | null
          first_response_due_at: string | null
          funnel_id: string | null
          gateway_error_log: string | null
          id: string
          last_activity_at: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_direction: string | null
          metadata: Json
          primary_channel: string
          priority: string
          product_id: string | null
          public_token: string | null
          queue_entered_at: string | null
          quiz_answers: Json
          sla_breached_at: string | null
          status: string
          transaction_id: string | null
          unread_count: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_predictive_capture_outcomes: {
        Args: { p_limit?: number }
        Returns: number
      }
      crm_predictive_evaluation_summary: {
        Args: { p_model_version?: string }
        Returns: Json
      }
      crm_predictive_scores: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      crm_predictive_snapshot: {
        Args: { p_conversation_id: string }
        Returns: string
      }
      crm_public_conversation: { Args: { p_token: string }; Returns: Json }
      crm_public_message: {
        Args: { p_body: string; p_token: string }
        Returns: Json
      }
      crm_record_channel_delivery_status: {
        Args: {
          p_channel_account_id: string
          p_external_message_id: string
          p_provider_event?: Json
          p_status: string
        }
        Returns: Json
      }
      crm_recovery_execute: { Args: { p_event_id: string }; Returns: Json }
      crm_recovery_opportunities: {
        Args: { p_days?: number }
        Returns: {
          amount: number
          buyer_email: string
          buyer_name: string
          conversation_id: string | null
          context_status: 'resolved' | 'unlinked' | 'ambiguous'
          currency: string
          event_id: string
          funnel_id: string
          next_action: string
          opportunity_type: string
          priority: number
          product_id: string
          received_at: string
          status: string
          transaction_id: string
        }[]
      }
      crm_replay_automation_execution: {
        Args: { p_execution_id: string; p_reason?: string }
        Returns: {
          action_type: string | null
          attempt_count: number
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          error_message: string | null
          event_id: string | null
          execution_key: string
          id: string
          input: Json
          max_attempts: number
          next_retry_at: string | null
          output: Json
          replay_count: number
          replayed_at: string | null
          rule_id: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "automation_executions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_replay_channel_outbox: {
        Args: { p_outbox_id: string; p_reason?: string; p_replay_key: string }
        Returns: Json
      }
      crm_requeue_stale_channel_outbox: {
        Args: { p_age_minutes?: number }
        Returns: number
      }
      crm_revenue_intelligence: { Args: { p_days?: number }; Returns: Json }
      dashboard_metrics_for_user: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json
      }
      dashboard_operational_data_for_user: {
        Args: {
          p_campaign?: string
          p_currency?: string
          p_end_date: string
          p_funnel?: string
          p_gateway?: string
          p_payment_method?: string
          p_product?: string
          p_source?: string
          p_start_date: string
          p_status?: string
        }
        Returns: Json
      }
      dashboard_production_data_for_user: {
        Args: {
          p_campaign?: string
          p_currency?: string
          p_end_date: string
          p_funnel?: string
          p_gateway?: string
          p_payment_method?: string
          p_product?: string
          p_source?: string
          p_start_date: string
          p_status?: string
        }
        Returns: Json
      }
      dashboard_production_data_for_user_secure: {
        Args: {
          p_campaign?: string
          p_currency?: string
          p_end_date: string
          p_funnel?: string
          p_gateway?: string
          p_payment_method?: string
          p_product?: string
          p_source?: string
          p_start_date: string
          p_status?: string
        }
        Returns: Json
      }
      decrypt_gateway_api_key: {
        Args: { p_ciphertext: string }
        Returns: string
      }
      disconnect_dynamic_gateway: {
        Args: { p_gateway_id: string }
        Returns: Json
      }
      encrypt_gateway_api_key: {
        Args: { p_plaintext: string }
        Returns: string
      }
      enqueue_checkout_recovery_events: {
        Args: { p_limit?: number }
        Returns: number
      }
      enqueue_core_job: {
        Args: {
          p_aggregate_id?: string
          p_aggregate_type?: string
          p_available_at?: string
          p_job_type: string
          p_max_attempts?: number
          p_payload?: Json
          p_user_id: string
        }
        Returns: {
          aggregate_id: string | null
          aggregate_type: string | null
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "core_job_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_gateway_payment_link_execution: {
        Args: {
          p_gateway_id: string
          p_idempotency_key: string
          p_payment_link_id: string
          p_request_payload?: Json
          p_user_id: string
        }
        Returns: Json
      }
      fail_gateway_payment_link_execution: {
        Args: {
          p_command_id: string
          p_error_code: string
          p_error_message: string
          p_retry_seconds?: number
          p_retryable?: boolean
        }
        Returns: Json
      }
      finalize_gateway_unknown_attempt: {
        Args: {
          p_external_id?: string
          p_failure_code?: string
          p_status: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: Json
      }
      finish_core_job: {
        Args: { p_error?: string; p_job_id: string; p_success: boolean }
        Returns: {
          aggregate_id: string | null
          aggregate_type: string | null
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "core_job_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      gateway_cleanup_orphan_orchestration_traces: {
        Args: never
        Returns: number
      }
      gateway_effective_cost_bps: {
        Args: {
          p_amount_minor: number
          p_card_brand: string
          p_gateway_id: string
          p_user_id: string
        }
        Returns: number
      }
      gateway_json_contains_forbidden_payment_data: {
        Args: { p_value: Json }
        Returns: boolean
      }
      gateway_routing_graph_condition_valid: {
        Args: { p_condition: Json }
        Returns: boolean
      }
      gateway_routing_graph_gateway_refs: {
        Args: { p_node: Json }
        Returns: string[]
      }
      gateway_routing_graph_validate_target_refs: {
        Args: { p_graph: Json }
        Returns: boolean
      }
      gateway_routing_graph_walk: {
        Args: { p_depth?: number; p_node: Json; p_path?: string[] }
        Returns: boolean
      }
      gateway_runtime_route_candidates:
        | {
            Args: {
              p_amount: number
              p_currency: string
              p_environment: string
              p_gateway_ids: string[]
              p_user_id: string
            }
            Returns: {
              approval_rate: number
              circuit_state: string
              cost_bps: number
              gateway_id: string
              healthy: boolean
              latency_ms: number
              routing_score: number
            }[]
          }
        | {
            Args: {
              p_amount: number
              p_card_brand?: string
              p_currency: string
              p_environment: string
              p_gateway_ids: string[]
              p_user_id: string
            }
            Returns: {
              approval_rate: number
              circuit_state: string
              cost_bps: number
              gateway_id: string
              healthy: boolean
              latency_ms: number
              routing_score: number
            }[]
          }
      gateway_token_link_runtime_context: {
        Args: { p_link_id: string; p_user_id: string }
        Returns: Json
      }
      get_active_gateway_routing_policy: {
        Args: { p_funnel_id: string; p_user_id: string }
        Returns: {
          policy_id: string
          policy_version: number
          routing_graph: Json
        }[]
      }
      get_althea_internal_secret: { Args: never; Returns: string }
      get_checkout_transaction_status: {
        Args: { p_checkout_session_id: string }
        Returns: {
          amount: number
          completed_at: string
          currency: string
          external_id: string
          gateway_id: string
          status: string
          transaction_id: string
          updated_at: string
        }[]
      }
      get_effective_gateway_override: {
        Args: { p_funnel_id: string; p_user_id: string }
        Returns: {
          expires_at: string
          gateway_id: string
        }[]
      }
      get_funnel_connection_health: {
        Args: { p_user_id: string }
        Returns: {
          error_count: number
          event_count: number
          funnel_id: string
          health_status: string
          last_error: string
          last_event_at: string
          status: string
        }[]
      }
      get_gateway_health: {
        Args: { p_gateway_id: string; p_window_minutes?: number }
        Returns: Json
      }
      get_gateway_panel_metrics: {
        Args: { p_gateway_id: string }
        Returns: Json
      }
      get_public_checkout_context: {
        Args: { p_funnel_id: string; p_offer_id?: string }
        Returns: Json
      }
      get_webhook_integration: {
        Args: { p_endpoint_key: string }
        Returns: {
          funnel_id: string
          id: string
          provider: string
          secret: string
          status: string
          user_id: string
        }[]
      }
      iara_allocate_memory_sequence: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      iara_claim_queue_jobs: {
        Args: {
          p_batch_size: number
          p_queue_name: string
          p_visibility_timeout_seconds: number
        }
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "message_record"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      iara_complete_feb_issuance: {
        Args: {
          p_error?: string
          p_idempotency_id: string
          p_result?: Json
          p_success: boolean
        }
        Returns: boolean
      }
      iara_complete_queue_job: {
        Args: { p_job_id: string; p_message_id: number; p_queue_name: string }
        Returns: boolean
      }
      iara_dead_letter_queue_job: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_job_id: string
          p_message_id: number
          p_queue_name: string
        }
        Returns: boolean
      }
      iara_enqueue_job: {
        Args: {
          p_idempotency_key: string
          p_job_id: string
          p_max_attempts: number
          p_payload: Json
          p_queue_name: string
          p_queue_type: string
          p_tenant_id: string
        }
        Returns: {
          duplicate: boolean
          job_id: string
          message_id: number
        }[]
      }
      iara_reserve_feb_issuance: {
        Args: {
          p_execution_id: string
          p_idempotency_key: string
          p_request_hash: string
          p_tenant_id: string
          p_tool_key: string
          p_tool_version: number
        }
        Returns: {
          acquired: boolean
          execution_id: string
          idempotency_id: string
          request_hash: string
          status: string
        }[]
      }
      iara_retry_queue_job: {
        Args: {
          p_delay_seconds: number
          p_error_code: string
          p_error_message: string
          p_job_id: string
          p_message_id: number
          p_next_attempt: number
          p_queue_name: string
        }
        Returns: boolean
      }
      ingest_gateway_webhook: {
        Args: {
          p_payload: Json
          p_provider: string
          p_provider_event_id: string
          p_signature_timestamp: string
        }
        Returns: {
          duplicate: boolean
          webhook_id: string
        }[]
      }
      ingest_gateway_webhook_v2: {
        Args: {
          p_gateway_id: string
          p_payload: Json
          p_provider: string
          p_provider_event_id: string
          p_signature_timestamp: string
        }
        Returns: {
          duplicate: boolean
          webhook_id: string
        }[]
      }
      list_gateway_credentials: {
        Args: never
        Returns: {
          gateway_name: string
          id: string
          is_active: boolean
          metadata: Json
          priority_order: number
        }[]
      }
      mark_abandoned_checkouts:
        | { Args: { p_after_minutes?: number }; Returns: number }
        | { Args: { p_minutes?: number; p_user_id: string }; Returns: number }
      mark_gateway_payment_link_failed: {
        Args: { p_link_id: string; p_reason: string }
        Returns: boolean
      }
      mark_integration_event_processed: {
        Args: { p_error?: string; p_event_id: string; p_status?: string }
        Returns: undefined
      }
      materialize_gateway_customer_identity: {
        Args: { p_transaction_id: string }
        Returns: string
      }
      mutate_gateway_checkout_price: {
        Args: {
          p_checkout_id: string
          p_currency: string
          p_idempotency_key: string
          p_new_amount: number
          p_reason: string
          p_transaction_id: string
        }
        Returns: Json
      }
      persist_iara_independent_evaluation: {
        Args: {
          p_assertions: Json
          p_causal_confidence: number
          p_claims: Json
          p_data_confidence: number
          p_decision: string
          p_evaluator_version: string
          p_evidence_coverage: number
          p_execution_id: string
          p_failures: Json
          p_grounding_score: number
          p_hallucination_risk: number
          p_latency_ms: number
          p_overall_score: number
          p_summary: string
          p_tenant_id: string
          p_tool_call_accuracy: number
          p_tool_calls: Json
          p_total_cost_minor: number
        }
        Returns: string
      }
      platform_release_ready: { Args: never; Returns: boolean }
      post_gateway_financial_journal: {
        Args: {
          p_currency: string
          p_gateway_id: string
          p_journal_type: string
          p_lines: Json
          p_metadata?: Json
          p_source_event_key: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: string
      }
      prepare_gateway_payment_link: {
        Args: {
          p_amount: number
          p_currency: string
          p_funnel_id: string
          p_idempotency_key: string
          p_link_type: string
          p_user_id: string
        }
        Returns: Json
      }
      process_gateway_webhook_v11: {
        Args: {
          p_amount?: number
          p_currency?: string
          p_event_kind?: string
          p_external_event_id?: string
          p_external_transaction_id: string
          p_failure_code?: string
          p_next_status: string
          p_webhook_id: string
        }
        Returns: Json
      }
      product_slugify: { Args: { p_name: string }; Returns: string }
      project_attribution_event: {
        Args: {
          p_event_type: string
          p_funnel_id: string
          p_payload?: Json
          p_session_key: string
          p_user_id: string
        }
        Returns: string
      }
      project_checkout_purchase: {
        Args: { p_checkout_id: string }
        Returns: Json
      }
      project_funnel_event: { Args: { p_event_id: string }; Returns: Json }
      project_sale_attribution: {
        Args: { p_sale_id: string }
        Returns: boolean
      }
      provision_funnel_atomic: {
        Args: {
          p_connection_type: string
          p_event_endpoint: string
          p_funnel_type: string
          p_name: string
          p_url: string
        }
        Returns: Json
      }
      provision_funnel_commercial_atomic: {
        Args: {
          p_connection_type: string
          p_event_endpoint: string
          p_funnel_type: string
          p_gateway_id: string
          p_name: string
          p_product_id: string
          p_url: string
        }
        Returns: Json
      }
      record_gateway_checkout_telemetry: {
        Args: {
          p_checkout_id: string
          p_event_type: string
          p_field_name?: string
          p_funnel_id: string
          p_payload?: Json
          p_payment_method?: string
          p_transaction_id: string
        }
        Returns: string
      }
      record_gateway_circuit_failure: {
        Args: {
          p_failure_class: string
          p_failure_threshold?: number
          p_gateway_id: string
          p_gateway_name: string
          p_user_id: string
        }
        Returns: {
          circuit_state: string
          failure_count: number
        }[]
      }
      record_gateway_circuit_success: {
        Args: {
          p_gateway_id: string
          p_gateway_name: string
          p_user_id: string
        }
        Returns: undefined
      }
      record_gateway_decline_detail: {
        Args: {
          p_attempt_id: string
          p_category: string
          p_gateway_id: string
          p_provider: string
          p_provider_code: string
          p_provider_request_id?: string
          p_provider_subcode: string
          p_raw_error?: Json
          p_safe_message: string
          p_transaction_id: string
        }
        Returns: string
      }
      record_gateway_health: {
        Args: {
          p_gateway_id: string
          p_gateway_name: string
          p_latency_ms?: number
          p_success: boolean
        }
        Returns: {
          checked_at: string
          circuit_state: string
          consecutive_failures: number
          details: Json
          gateway_id: string | null
          gateway_name: string
          id: string
          is_healthy: boolean
          latency_ms: number | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "gateway_health_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_platform_health_check: {
        Args: { p_check_name: string; p_details?: Json; p_status: string }
        Returns: undefined
      }
      recover_stale_core_jobs: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      register_dynamic_gateway: {
        Args: {
          p_credentials: Json
          p_display_name: string
          p_environment: string
          p_metadata?: Json
          p_provider_key: string
        }
        Returns: Json
      }
      register_gateway_payment_token_link: {
        Args: {
          p_gateway_id: string
          p_instrument_id: string
          p_provider: string
          p_token: string
          p_token_fingerprint?: string
        }
        Returns: string
      }
      register_gateway_provider_definition:
        | {
            Args: {
              p_adapter_key?: string
              p_adapter_url?: string
              p_capabilities?: Json
              p_credential_schema?: Json
              p_display_name: string
              p_provider_key: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_adapter_key?: string
              p_adapter_url?: string
              p_capabilities?: Json
              p_credential_schema?: Json
              p_display_name: string
              p_execution_config?: Json
              p_provider_key: string
              p_webhook_config?: Json
            }
            Returns: Json
          }
      register_integration_event: {
        Args: {
          p_event_type: string
          p_external_id: string
          p_funnel_id: string
          p_occurred_at?: string
          p_payload: Json
        }
        Returns: string
      }
      reserve_idempotency_key: {
        Args: {
          p_idempotency_key: string
          p_request_digest: string
          p_scope: string
          p_ttl?: string
          p_user_id: string
        }
        Returns: {
          acquired: boolean
          id: string
          lease_token: string
          resource_id: string
          resource_type: string
          response_code: number
          response_payload: Json
          status: string
        }[]
      }
      reserve_transaction_audit_event: {
        Args: {
          p_event_type: string
          p_idempotency_key: string
          p_metadata?: Json
          p_organization_id: string
          p_source?: string
          p_transaction_id?: string
        }
        Returns: {
          audit_event_id: string
          reserved: boolean
        }[]
      }
      resolve_funnel_ingestion_token: {
        Args: { p_token_hash: string }
        Returns: {
          funnel_id: string
          token_id: string
          user_id: string
        }[]
      }
      resolve_gateway_credential:
        | { Args: { p_credential_id: string }; Returns: Json }
        | {
            Args: { p_credential_id: string; p_organization_id: string }
            Returns: Json
          }
      resolve_gateway_credential_bundle: {
        Args: { p_gateway_id: string }
        Returns: Json
      }
      resolve_gateway_credential_for_gateway: {
        Args: { p_gateway_id: string }
        Returns: Json
      }
      resolve_gateway_operator_events: {
        Args: { p_limit?: number }
        Returns: {
          checkout_id: string | null
          created_at: string
          delivered_at: string | null
          event_type: string
          funnel_id: string | null
          id: string
          idempotency_key: string
          payload: Json
          status: string
          transaction_id: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "gateway_operator_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      resolve_gateway_payment_token: {
        Args: { p_link_id: string; p_user_id?: string }
        Returns: string
      }
      resolve_gateway_webhook_secret: {
        Args: { p_gateway_id: string }
        Returns: string
      }
      restore_product: {
        Args: { p_product_id: string; p_version: number }
        Returns: {
          billing_interval: string | null
          billing_type: string
          created_at: string | null
          currency: string
          data: Json | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          interval_count: number | null
          metadata: Json
          name: string | null
          organization_id: string
          product_type: string | null
          sku: string | null
          slug: string | null
          status: string
          unit_amount: number
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_gateway_payment_token_link: {
        Args: { p_link_id: string }
        Returns: boolean
      }
      rotate_gateway_payment_token_link: {
        Args: {
          p_link_id: string
          p_token: string
          p_token_fingerprint?: string
        }
        Returns: string
      }
      sales_ledger_for_user: {
        Args: {
          p_from?: string
          p_funnel_id?: string
          p_gateway_id?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
          p_to?: string
        }
        Returns: Json
      }
      save_funnel_domain_connection: {
        Args: {
          p_chat_enabled: boolean
          p_external_funnel_id: string
          p_funnel_id: string
          p_name: string
          p_pixel_id: string
          p_url: string
        }
        Returns: Json
      }
      schedule_integration_event_retry: {
        Args: { p_error?: string; p_event_id: string }
        Returns: boolean
      }
      seed_funnel_structure: {
        Args: { target_funnel: string }
        Returns: {
          config: Json
          created_at: string
          funnel_id: string
          id: string
          name: string
          organization_id: string
          position: number
          status: string
          step_key: string
          step_type: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "funnel_steps"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_gateway_credential_status: {
        Args: { p_credential_id: string; p_is_active: boolean }
        Returns: Json
      }
      set_gateway_routing_override: {
        Args: {
          p_expires_at: string
          p_forced_gateway_id: string
          p_funnel_id: string
          p_reason: string
        }
        Returns: string
      }
      set_gateway_routing_split_policy: {
        Args: { p_allocations: Json; p_funnel_id: string; p_name: string }
        Returns: string
      }
      set_product_status: {
        Args: { p_product_id: string; p_status: string; p_version: number }
        Returns: {
          billing_interval: string | null
          billing_type: string
          created_at: string | null
          currency: string
          data: Json | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          interval_count: number | null
          metadata: Json
          name: string | null
          organization_id: string
          product_type: string | null
          sku: string | null
          slug: string | null
          status: string
          unit_amount: number
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_iara_pix: {
        Args: {
          p_event_id: string
          p_paid_amount_cents: number
          p_payload: Json
          p_pix_invoice_id: string
          p_provider_payment_id: string
          p_signature_verified: boolean
          p_user_id: string
        }
        Returns: {
          already_settled: boolean
          invoice_id: string
          journal_id: string
          settled: boolean
          status: string
          transaction_id: string
        }[]
      }
      store_webhook_secret: {
        Args: { p_name?: string; p_secret: string }
        Returns: string
      }
      switch_funnel_gateway: {
        Args: { p_funnel_id: string; p_gateway_id: string }
        Returns: Json
      }
      switch_funnel_primary_gateway: {
        Args: { p_funnel_id: string; p_gateway_id: string }
        Returns: Json
      }
      touch_webhook_integration: {
        Args: { p_endpoint_key: string }
        Returns: undefined
      }
      transition_gateway_recovery_state: {
        Args: {
          p_expected_version: number
          p_job_id: string
          p_next_retry_at?: string
          p_next_state: Database["public"]["Enums"]["recovery_state"]
          p_note?: string
        }
        Returns: {
          current_state: Database["public"]["Enums"]["recovery_state"]
          state_version: number
          updated: boolean
        }[]
      }
      transition_gateway_transaction: {
        Args: {
          p_error_message?: string
          p_next_status: string
          p_transaction_id: string
        }
        Returns: {
          amount: number
          attempt_count: number
          completed_at: string | null
          created_at: string
          currency: string
          customer: Json
          error_message: string | null
          external_id: string | null
          failure_code: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          product_id: string | null
          routing_metadata: Json
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "gateway_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_gateway_transaction_status: {
        Args: {
          p_expected_version: number
          p_external_id: string
          p_failure_code: string
          p_next_status: string
          p_transaction_id: string
          p_user_id: string
        }
        Returns: {
          amount: number
          attempt_count: number
          completed_at: string | null
          created_at: string
          currency: string
          customer: Json
          error_message: string | null
          external_id: string | null
          failure_code: string | null
          funnel_id: string | null
          gateway_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          organization_id: string
          product_id: string | null
          routing_metadata: Json
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "gateway_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      trigger_reconciliation_worker: { Args: never; Returns: number }
      update_dynamic_gateway: {
        Args: {
          p_credentials?: Json
          p_display_name: string
          p_environment: string
          p_gateway_id: string
        }
        Returns: Json
      }
      update_funnel_step: {
        Args: {
          p_config?: Json
          p_name?: string
          p_status?: string
          p_step_id: string
        }
        Returns: {
          config: Json
          created_at: string
          funnel_id: string
          id: string
          name: string
          organization_id: string
          position: number
          status: string
          step_key: string
          step_type: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "funnel_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_product: {
        Args: {
          p_billing_interval: string
          p_billing_type: string
          p_currency: string
          p_description: string
          p_interval_count: number
          p_metadata: Json
          p_name: string
          p_product_id: string
          p_product_type: string
          p_sku: string
          p_slug: string
          p_status?: string
          p_unit_amount: number
          p_version: number
        }
        Returns: {
          billing_interval: string | null
          billing_type: string
          created_at: string | null
          currency: string
          data: Json | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          interval_count: number | null
          metadata: Json
          name: string | null
          organization_id: string
          product_type: string | null
          sku: string | null
          slug: string | null
          status: string
          unit_amount: number
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_webhook_secret: {
        Args: { p_name?: string; p_secret: string; p_secret_id: string }
        Returns: string
      }
      upsert_gateway_credential: {
        Args: {
          p_api_key: string
          p_gateway_name: string
          p_is_active?: boolean
          p_metadata?: Json
          p_priority_order?: number
        }
        Returns: Json
      }
      upsert_gateway_webhook_secret: {
        Args: { p_gateway_id: string; p_secret: string }
        Returns: Json
      }
      validate_gateway_credential_schema: {
        Args: { p_credentials: Json; p_schema: Json }
        Returns: boolean
      }
      validate_gateway_routing_graph: {
        Args: { p_graph: Json }
        Returns: boolean
      }
      verify_althea_internal_secret: {
        Args: { p_secret: string }
        Returns: boolean
      }
      verify_gateway_recovery_cron_signature: {
        Args: { p_signature: string; p_timestamp: number }
        Returns: boolean
      }
      verify_gateway_recovery_cron_token: {
        Args: { p_token: string }
        Returns: boolean
      }
    }
    Enums: {
      lead_checkout_status:
        | "respondendo_quiz"
        | "no_checkout"
        | "parado_no_caixa"
        | "cartao_recusado"
        | "pago"
      recovery_state:
        | "UNKNOWN"
        | "RECOVERY"
        | "STATUS_CHECK"
        | "APPROVED"
        | "DECLINED"
        | "PENDING"
        | "DEAD_LETTER"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      lead_checkout_status: [
        "respondendo_quiz",
        "no_checkout",
        "parado_no_caixa",
        "cartao_recusado",
        "pago",
      ],
      recovery_state: [
        "UNKNOWN",
        "RECOVERY",
        "STATUS_CHECK",
        "APPROVED",
        "DECLINED",
        "PENDING",
        "DEAD_LETTER",
      ],
    },
  },
} as const
