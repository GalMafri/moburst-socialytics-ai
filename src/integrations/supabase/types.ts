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
      app_events: {
        Row: {
          client_id: string | null
          company: string | null
          company_slug: string | null
          duration_ms: number | null
          email: string | null
          entity_id: string | null
          error_code: string | null
          event: string
          execution_id: string | null
          id: number
          occurred_at: string
          ok: boolean | null
          path: string | null
          props: Json
          received_at: string
          role: string | null
          seq: number | null
          session_id: string | null
          tool: string | null
          user_id: string | null
        }
        Insert: {
          client_id?: string | null
          company?: string | null
          company_slug?: string | null
          duration_ms?: number | null
          email?: string | null
          entity_id?: string | null
          error_code?: string | null
          event: string
          execution_id?: string | null
          id?: number
          occurred_at?: string
          ok?: boolean | null
          path?: string | null
          props?: Json
          received_at?: string
          role?: string | null
          seq?: number | null
          session_id?: string | null
          tool?: string | null
          user_id?: string | null
        }
        Update: {
          client_id?: string | null
          company?: string | null
          company_slug?: string | null
          duration_ms?: number | null
          email?: string | null
          entity_id?: string | null
          error_code?: string | null
          event?: string
          execution_id?: string | null
          id?: number
          occurred_at?: string
          ok?: boolean | null
          path?: string | null
          props?: Json
          received_at?: string
          role?: string | null
          seq?: number | null
          session_id?: string | null
          tool?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      brand_voice_learnings: {
        Row: {
          client_id: string
          confidence: number | null
          created_at: string | null
          id: string
          pattern_description: string
          pattern_type: string
          source_iterations: number | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          pattern_description: string
          pattern_type: string
          source_iterations?: number | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          pattern_description?: string
          pattern_type?: string
          source_iterations?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_voice_learnings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_users: {
        Row: {
          client_id: string
          created_at: string | null
          id: string
          role: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string | null
          id?: string
          role?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string | null
          id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          brand_book_file_path: string | null
          brand_book_text: string | null
          brand_book_url: string | null
          brand_identity: Json | null
          brand_notes: string | null
          brief_file_id: string | null
          brief_text: string | null
          company_slug: string | null
          competitor_seed_notes: string | null
          content_pillars: Json | null
          created_at: string | null
          created_by: string | null
          design_references: Json | null
          design_style_synthesis: Json | null
          exclude_from_reporting: boolean
          geo: string | null
          hub_company_name: string | null
          id: string
          language: string | null
          logo_url: string | null
          name: string
          primary_platforms: string[] | null
          social_keywords: string[] | null
          sprout_customer_id: string | null
          timezone: string | null
          trends_keywords: string | null
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          archived_at?: string | null
          brand_book_file_path?: string | null
          brand_book_text?: string | null
          brand_book_url?: string | null
          brand_identity?: Json | null
          brand_notes?: string | null
          brief_file_id?: string | null
          brief_text?: string | null
          company_slug?: string | null
          competitor_seed_notes?: string | null
          content_pillars?: Json | null
          created_at?: string | null
          created_by?: string | null
          design_references?: Json | null
          design_style_synthesis?: Json | null
          exclude_from_reporting?: boolean
          geo?: string | null
          hub_company_name?: string | null
          id?: string
          language?: string | null
          logo_url?: string | null
          name: string
          primary_platforms?: string[] | null
          social_keywords?: string[] | null
          sprout_customer_id?: string | null
          timezone?: string | null
          trends_keywords?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          archived_at?: string | null
          brand_book_file_path?: string | null
          brand_book_text?: string | null
          brand_book_url?: string | null
          brand_identity?: Json | null
          brand_notes?: string | null
          brief_file_id?: string | null
          brief_text?: string | null
          company_slug?: string | null
          competitor_seed_notes?: string | null
          content_pillars?: Json | null
          created_at?: string | null
          created_by?: string | null
          design_references?: Json | null
          design_style_synthesis?: Json | null
          exclude_from_reporting?: boolean
          geo?: string | null
          hub_company_name?: string | null
          id?: string
          language?: string | null
          logo_url?: string | null
          name?: string
          primary_platforms?: string[] | null
          social_keywords?: string[] | null
          sprout_customer_id?: string | null
          timezone?: string | null
          trends_keywords?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      competitive_reports: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          date_range_end: string | null
          date_range_start: string | null
          duration_minutes: number | null
          gamma_url: string | null
          id: string
          report_data: Json
          set_id: string | null
          status: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          duration_minutes?: number | null
          gamma_url?: string | null
          id?: string
          report_data?: Json
          set_id?: string | null
          status?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          duration_minutes?: number | null
          gamma_url?: string | null
          id?: string
          report_data?: Json
          set_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitive_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitive_reports_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "competitor_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_handles: {
        Row: {
          client_id: string
          competitor_id: string
          detected_at: string
          detection_confidence: number | null
          followers: number | null
          handle: string
          id: string
          is_active: boolean
          platform: string
          profile_url: string | null
        }
        Insert: {
          client_id: string
          competitor_id: string
          detected_at?: string
          detection_confidence?: number | null
          followers?: number | null
          handle: string
          id?: string
          is_active?: boolean
          platform: string
          profile_url?: string | null
        }
        Update: {
          client_id?: string
          competitor_id?: string
          detected_at?: string
          detection_confidence?: number | null
          followers?: number | null
          handle?: string
          id?: string
          is_active?: boolean
          platform?: string
          profile_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_handles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_handles_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_sets: {
        Row: {
          client_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          generated_by: string | null
          id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          generated_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          generated_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_sets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_selected: boolean
          name: string
          rationale: string | null
          rivaliq_company_id: string | null
          selected_rank: number | null
          set_id: string
          similarity_score: number | null
          source: string
          website_url: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_selected?: boolean
          name: string
          rationale?: string | null
          rivaliq_company_id?: string | null
          selected_rank?: number | null
          set_id: string
          similarity_score?: number | null
          source?: string
          website_url?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_selected?: boolean
          name?: string
          rationale?: string | null
          rivaliq_company_id?: string | null
          selected_rank?: number | null
          set_id?: string
          similarity_score?: number | null
          source?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitors_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "competitor_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      design_states: {
        Row: {
          canvas_json: Json
          client_id: string
          created_at: string | null
          id: string
          is_template: boolean | null
          post_iteration_id: string | null
          template_name: string | null
          thumbnail_url: string | null
          updated_at: string | null
        }
        Insert: {
          canvas_json: Json
          client_id: string
          created_at?: string | null
          id?: string
          is_template?: boolean | null
          post_iteration_id?: string | null
          template_name?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Update: {
          canvas_json?: Json
          client_id?: string
          created_at?: string | null
          id?: string
          is_template?: boolean | null
          post_iteration_id?: string | null
          template_name?: string | null
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "design_states_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_states_post_iteration_id_fkey"
            columns: ["post_iteration_id"]
            isOneToOne: false
            referencedRelation: "post_iterations"
            referencedColumns: ["id"]
          },
        ]
      }
      gos_usage_snapshot: {
        Row: {
          company_slug: string | null
          executions_completed: number
          executions_failed: number
          executions_started: number
          frozen_at: string
          id: number
          outputs_delivered: number
          quarter: string
          row_hash: string
          tool: string
          tool_opens: number
          user_email: string | null
        }
        Insert: {
          company_slug?: string | null
          executions_completed?: number
          executions_failed?: number
          executions_started?: number
          frozen_at?: string
          id?: number
          outputs_delivered?: number
          quarter: string
          row_hash: string
          tool: string
          tool_opens?: number
          user_email?: string | null
        }
        Update: {
          company_slug?: string | null
          executions_completed?: number
          executions_failed?: number
          executions_started?: number
          frozen_at?: string
          id?: number
          outputs_delivered?: number
          quarter?: string
          row_hash?: string
          tool?: string
          tool_opens?: number
          user_email?: string | null
        }
        Relationships: []
      }
      media_jobs: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          input: Json
          kind: string
          model_path: string | null
          output_url: string | null
          post_iteration_id: string | null
          provider: string
          request_id: string | null
          seed_image_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          input?: Json
          kind: string
          model_path?: string | null
          output_url?: string | null
          post_iteration_id?: string | null
          provider?: string
          request_id?: string | null
          seed_image_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          input?: Json
          kind?: string
          model_path?: string | null
          output_url?: string | null
          post_iteration_id?: string | null
          provider?: string
          request_id?: string | null
          seed_image_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_jobs_post_iteration_id_fkey"
            columns: ["post_iteration_id"]
            isOneToOne: false
            referencedRelation: "post_iterations"
            referencedColumns: ["id"]
          },
        ]
      }
      post_iterations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_id: string
          concept: string | null
          created_at: string | null
          created_by: string | null
          cta: string | null
          format: string | null
          hashtags: string[] | null
          id: string
          is_approved: boolean | null
          is_selected: boolean | null
          media_urls: string[] | null
          platform: string | null
          post_copy: string | null
          recommendation_index: number | null
          report_id: string | null
          source: string | null
          variant_angle: string | null
          variant_group_id: string | null
          version: number
          video_edits: Json | null
          visual_direction: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          concept?: string | null
          created_at?: string | null
          created_by?: string | null
          cta?: string | null
          format?: string | null
          hashtags?: string[] | null
          id?: string
          is_approved?: boolean | null
          is_selected?: boolean | null
          media_urls?: string[] | null
          platform?: string | null
          post_copy?: string | null
          recommendation_index?: number | null
          report_id?: string | null
          source?: string | null
          variant_angle?: string | null
          variant_group_id?: string | null
          version?: number
          video_edits?: Json | null
          visual_direction?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          concept?: string | null
          created_at?: string | null
          created_by?: string | null
          cta?: string | null
          format?: string | null
          hashtags?: string[] | null
          id?: string
          is_approved?: boolean | null
          is_selected?: boolean | null
          media_urls?: string[] | null
          platform?: string | null
          post_copy?: string | null
          recommendation_index?: number | null
          report_id?: string | null
          source?: string | null
          variant_angle?: string | null
          variant_group_id?: string | null
          version?: number
          video_edits?: Json | null
          visual_direction?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_iterations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_iterations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allowed_company_slugs: string[] | null
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          email: string | null
          hub_company_name: string | null
          hub_user_id: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          allowed_company_slugs?: string[] | null
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          hub_company_name?: string | null
          hub_user_id?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          allowed_company_slugs?: string[] | null
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          hub_company_name?: string | null
          hub_user_id?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      report_schedules: {
        Row: {
          analysis_date_range_days: number | null
          client_id: string
          created_at: string | null
          created_by: string | null
          frequency: string
          id: string
          is_active: boolean | null
          last_run_at: string | null
          next_run_at: string | null
          trends_date_range_days: number | null
          updated_at: string | null
        }
        Insert: {
          analysis_date_range_days?: number | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          trends_date_range_days?: number | null
          updated_at?: string | null
        }
        Update: {
          analysis_date_range_days?: number | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          trends_date_range_days?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          client_id: string
          created_at: string | null
          created_by: string | null
          date_range_end: string | null
          date_range_start: string | null
          duration_minutes: number | null
          gamma_url: string | null
          id: string
          report_data: Json
          report_type: string | null
          status: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          created_by?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          duration_minutes?: number | null
          gamma_url?: string | null
          id?: string
          report_data?: Json
          report_type?: string | null
          status?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          date_range_end?: string | null
          date_range_start?: string | null
          duration_minutes?: number | null
          gamma_url?: string | null
          id?: string
          report_data?: Json
          report_type?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_posts: {
        Row: {
          client_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          media_url: string | null
          platform: string | null
          post_content: string | null
          profile_id: string | null
          report_id: string | null
          scheduled_time: string | null
          sprout_post_id: string | null
          status: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          media_url?: string | null
          platform?: string | null
          post_content?: string | null
          profile_id?: string | null
          report_id?: string | null
          scheduled_time?: string | null
          sprout_post_id?: string | null
          status?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          media_url?: string | null
          platform?: string | null
          post_content?: string | null
          profile_id?: string | null
          report_id?: string | null
          scheduled_time?: string | null
          sprout_post_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_posts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "sprout_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_posts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      sprout_profiles: {
        Row: {
          assigned_at: string | null
          client_id: string
          id: string
          is_active: boolean | null
          native_link: string | null
          native_name: string | null
          network_type: string
          profile_name: string | null
          sprout_profile_id: number
        }
        Insert: {
          assigned_at?: string | null
          client_id: string
          id?: string
          is_active?: boolean | null
          native_link?: string | null
          native_name?: string | null
          network_type: string
          profile_name?: string | null
          sprout_profile_id: number
        }
        Update: {
          assigned_at?: string | null
          client_id?: string
          id?: string
          is_active?: boolean | null
          native_link?: string | null
          native_name?: string | null
          network_type?: string
          profile_name?: string | null
          sprout_profile_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "sprout_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      gos_events: {
        Row: {
          company_slug: string | null
          duration_ms: number | null
          event: string | null
          execution_id: string | null
          occurred_at: string | null
          ok: boolean | null
          props: Json | null
          tool: string | null
          user_email: string | null
          user_id: string | null
        }
        Relationships: []
      }
      user_activity: {
        Row: {
          action: string | null
          at: string | null
          client_id: string | null
          outcome: string | null
          seconds: number | null
          user_id: string | null
        }
        Relationships: []
      }
      user_analytics: {
        Row: {
          abandoned: number | null
          actions_total: number | null
          active_days: number | null
          clients_created: number | null
          clients_touched: number | null
          company: string | null
          email: string | null
          failures: number | null
          first_action_at: string | null
          last_action_at: string | null
          last_sign_in_at: string | null
          name: string | null
          posts_approved: number | null
          posts_created: number | null
          posts_iterated: number | null
          provisioned_at: string | null
          reports_ok: number | null
          role: string | null
          state: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      attribution_health: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          failing: number
        }[]
      }
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_manage_roster: { Args: never; Returns: boolean }
      can_write_client: { Args: { _client_id: string }; Returns: boolean }
      freeze_quarter: {
        Args: { p_quarter: string }
        Returns: {
          note: string
          rows_written: number
          status: string
        }[]
      }
      get_ai_quality: {
        Args: { days?: number }
        Returns: {
          metric: string
          sample: number
          value: number
        }[]
      }
      get_feature_adoption: {
        Args: { days?: number }
        Returns: {
          event: string
          failures: number
          median_ms: number
          users: number
          uses: number
        }[]
      }
      get_funnel: {
        Args: { days?: number }
        Returns: {
          events: number
          step: string
          step_order: number
          users: number
        }[]
      }
      get_report_engagement: {
        Args: { days?: number }
        Returns: {
          metric: string
          sample: number
          value: number
        }[]
      }
      get_session_quality: {
        Args: { days?: number }
        Returns: {
          metric: string
          sample: number
          value: number
        }[]
      }
      get_usage_trend: {
        Args: never
        Returns: {
          actions: number
          active_users: number
          day: string
        }[]
      }
      get_user_analytics: {
        Args: never
        Returns: {
          abandoned: number | null
          actions_total: number | null
          active_days: number | null
          clients_created: number | null
          clients_touched: number | null
          company: string | null
          email: string | null
          failures: number | null
          first_action_at: string | null
          last_action_at: string | null
          last_sign_in_at: string | null
          name: string | null
          posts_approved: number | null
          posts_created: number | null
          posts_iterated: number | null
          provisioned_at: string | null
          reports_ok: number | null
          role: string | null
          state: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "user_analytics"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_detail: {
        Args: { p_email: string }
        Returns: {
          metric: string
          tone: string
          value: string
        }[]
      }
      get_user_timeline: {
        Args: { p_email: string; p_limit?: number }
        Returns: {
          at: string
          client_name: string
          detail: string
          entity_id: string
          kind: string
          label: string
          status: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_client_member: { Args: { _client_id: string }; Returns: boolean }
      is_company_restricted: { Args: never; Returns: boolean }
      is_moburst_staff: { Args: never; Returns: boolean }
      purge_raw_events: {
        Args: { p_keep_months?: number }
        Returns: {
          deleted: number
          note: string
          status: string
        }[]
      }
      verify_quarter: {
        Args: { p_quarter: string }
        Returns: {
          frozen_at: string
          intact: boolean
          quarter: string
          rows: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user" | "moburst_user" | "client"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "user", "moburst_user", "client"],
    },
  },
} as const
