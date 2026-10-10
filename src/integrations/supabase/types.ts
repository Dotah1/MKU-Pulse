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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campus_crushes: {
        Row: {
          compliment_tag: string
          created_at: string
          id: string
          is_revealed: boolean
          recipient_id: string
          sender_id: string
        }
        Insert: {
          compliment_tag: string
          created_at?: string
          id?: string
          is_revealed?: boolean
          recipient_id: string
          sender_id: string
        }
        Update: {
          compliment_tag?: string
          created_at?: string
          id?: string
          is_revealed?: boolean
          recipient_id?: string
          sender_id?: string
        }
        Relationships: []
      }
      campus_events: {
        Row: {
          category: string
          created_at: string
          creator_id: string
          description: string | null
          ends_at: string | null
          id: string
          location: string
          starts_at: string
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          creator_id: string
          description?: string | null
          ends_at?: string | null
          id?: string
          location: string
          starts_at: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          creator_id?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          location?: string
          starts_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "campus_events_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message: string
          last_message_at: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message?: string
          last_message_at?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message?: string
          last_message_at?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      daily_user_quotas: {
        Row: {
          posts_count: number
          super_likes_count: number
          swipes_count: number
          usage_date: string
          user_id: string
          videos_count: number
        }
        Insert: {
          posts_count?: number
          super_likes_count?: number
          swipes_count?: number
          usage_date: string
          user_id: string
          videos_count?: number
        }
        Update: {
          posts_count?: number
          super_likes_count?: number
          swipes_count?: number
          usage_date?: string
          user_id?: string
          videos_count?: number
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      mentor_applications: {
        Row: {
          admin_note: string | null
          availability: string
          created_at: string
          experience: string
          expertise: string
          id: string
          mentorship_areas: string[]
          photo_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          availability: string
          created_at?: string
          experience: string
          expertise: string
          id?: string
          mentorship_areas?: string[]
          photo_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          availability?: string
          created_at?: string
          experience?: string
          expertise?: string
          id?: string
          mentorship_areas?: string[]
          photo_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mentor_sessions: {
        Row: {
          created_at: string
          id: string
          mentor_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["request_status"]
          student_id: string
          topic: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentor_id: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["request_status"]
          student_id: string
          topic: string
        }
        Update: {
          created_at?: string
          id?: string
          mentor_id?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["request_status"]
          student_id?: string
          topic?: string
        }
        Relationships: []
      }
      mentors: {
        Row: {
          availability: string
          created_at: string
          experience: string
          expertise: string
          mentorship_areas: string[]
          rating: number
          rating_count: number
          user_id: string
        }
        Insert: {
          availability?: string
          created_at?: string
          experience?: string
          expertise?: string
          mentorship_areas?: string[]
          rating?: number
          rating_count?: number
          user_id: string
        }
        Update: {
          availability?: string
          created_at?: string
          experience?: string
          expertise?: string
          mentorship_areas?: string[]
          rating?: number
          rating_count?: number
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          post_id: string | null
          read_at: string | null
          reply_to_id: string | null
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          post_id?: string | null
          read_at?: string | null
          reply_to_id?: string | null
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          post_id?: string | null
          read_at?: string | null
          reply_to_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mku_verification_codes: {
        Row: {
          attempts: number
          code: string | null
          code_hash: string
          created_at: string
          email: string
          expires_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code?: string | null
          code_hash: string
          created_at?: string
          email: string
          expires_at: string
          user_id: string
        }
        Update: {
          attempts?: number
          code?: string | null
          code_hash?: string
          created_at?: string
          email?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mku_verification_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          read_at: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      payment_requests: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          id: string
          mpesa_code: string
          payer_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["request_status"]
          tier: Database["public"]["Enums"]["sub_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string
          id?: string
          mpesa_code: string
          payer_name: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          tier: Database["public"]["Enums"]["sub_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          id?: string
          mpesa_code?: string
          payer_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          tier?: Database["public"]["Enums"]["sub_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      poll_options: {
        Row: {
          created_at: string
          id: string
          label: string
          poll_id: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          poll_id: string
          position?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          poll_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          closes_at: string | null
          created_at: string
          created_by: string
          id: string
          image_url: string | null
          is_active: boolean
          question: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          question: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          question?: string
          updated_at?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          parent_id: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          content: string
          created_at: string
          id: string
          image_url: string | null
          is_announcement: boolean
          updated_at: string
          user_id: string
          video_seconds: number | null
          video_url: string | null
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_announcement?: boolean
          updated_at?: string
          user_id: string
          video_seconds?: number | null
          video_url?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_announcement?: boolean
          updated_at?: string
          user_id?: string
          video_seconds?: number | null
          video_url?: string | null
        }
        Relationships: []
      }
      profile_contacts: {
        Row: {
          email: string
          id: string
          mku_email: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          email?: string
          id: string
          mku_email?: string | null
          phone?: string
          updated_at?: string
        }
        Update: {
          email?: string
          id?: string
          mku_email?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string
          created_at: string
          full_name: string
          gender: Database["public"]["Enums"]["user_gender"] | null
          id: string
          interests: string[]
          is_banned: boolean
          is_private: boolean
          last_active_on: string | null
          major: string
          mku_verified: boolean
          notifications_enabled: boolean
          pending_tier: Database["public"]["Enums"]["sub_tier"] | null
          post_block_until: string | null
          streak_count: number
          tier: Database["public"]["Enums"]["sub_tier"]
          tier_expires_at: string | null
          updated_at: string
          year_of_study: number
        }
        Insert: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          full_name?: string
          gender?: Database["public"]["Enums"]["user_gender"] | null
          id: string
          interests?: string[]
          is_banned?: boolean
          is_private?: boolean
          last_active_on?: string | null
          major?: string
          mku_verified?: boolean
          notifications_enabled?: boolean
          pending_tier?: Database["public"]["Enums"]["sub_tier"] | null
          post_block_until?: string | null
          streak_count?: number
          tier?: Database["public"]["Enums"]["sub_tier"]
          tier_expires_at?: string | null
          updated_at?: string
          year_of_study?: number
        }
        Update: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          full_name?: string
          gender?: Database["public"]["Enums"]["user_gender"] | null
          id?: string
          interests?: string[]
          is_banned?: boolean
          is_private?: boolean
          last_active_on?: string | null
          major?: string
          mku_verified?: boolean
          notifications_enabled?: boolean
          pending_tier?: Database["public"]["Enums"]["sub_tier"] | null
          post_block_until?: string | null
          streak_count?: number
          tier?: Database["public"]["Enums"]["sub_tier"]
          tier_expires_at?: string | null
          updated_at?: string
          year_of_study?: number
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reporter_id: string
          status: Database["public"]["Enums"]["request_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string
          reporter_id: string
          status?: Database["public"]["Enums"]["request_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target"]
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string
          status?: Database["public"]["Enums"]["request_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target"]
        }
        Relationships: []
      }
      swipes: {
        Row: {
          action: Database["public"]["Enums"]["swipe_action"]
          created_at: string
          id: string
          swipee_id: string
          swiper_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["swipe_action"]
          created_at?: string
          id?: string
          swipee_id: string
          swiper_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["swipe_action"]
          created_at?: string
          id?: string
          swipee_id?: string
          swiper_id?: string
        }
        Relationships: []
      }
      typing_state: {
        Row: {
          conversation_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "typing_state_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      blocked_user_ids: { Args: never; Returns: string[] }
      check_in_streak: { Args: { _today: string }; Returns: number }
      conversation_blocked: { Args: { _conv: string }; Returns: boolean }
      create_campus_event: {
        Args: {
          p_category: string
          p_description: string
          p_ends_at: string
          p_location: string
          p_starts_at: string
          p_title: string
        }
        Returns: {
          category: string
          created_at: string
          creator_id: string
          description: string | null
          ends_at: string | null
          id: string
          location: string
          starts_at: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "campus_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_expired_posts: { Args: never; Returns: number }
      effective_tier: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["sub_tier"]
      }
      get_connect_candidates: {
        Args: { _after_id: string; _limit: number }
        Returns: {
          avatar_url: string
          bio: string
          full_name: string
          id: string
          interests: string[]
          is_banned: boolean
          is_private: boolean
          major: string
          tier: Database["public"]["Enums"]["sub_tier"]
          year_of_study: number
        }[]
      }
      get_my_conversation_page: {
        Args: {
          _before_id: string
          _before_last_message_at: string
          _conversation_id: string
          _limit: number
        }
        Returns: {
          id: string
          is_mentor: boolean
          last_message: string
          last_message_at: string
          unread_count: number
          user_a: string
          user_b: string
        }[]
      }
      get_my_daily_quota_usage: {
        Args: never
        Returns: {
          posts_count: number
          super_likes_count: number
          swipes_count: number
          videos_count: number
        }[]
      }
      get_post_card_metrics: {
        Args: { _post_ids: string[] }
        Returns: {
          comment_count: number
          like_count: number
          post_id: string
          viewer_liked: boolean
          viewer_reported: boolean
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      in_conversation: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      initialize_daily_user_quota_row: {
        Args: { _usage_date: string; _user_id: string }
        Returns: undefined
      }
      is_blocked_between: { Args: { _a: string; _b: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      mark_mku_verified: {
        Args: { _email: string; _user: string }
        Returns: undefined
      }
      my_compliments: {
        Args: never
        Returns: {
          compliment_tag: string
          created_at: string
          id: string
          is_revealed: boolean
          sender_id: string
        }[]
      }
      poll_vote_counts: {
        Args: { _poll: string }
        Returns: {
          option_id: string
          votes: number
        }[]
      }
      purge_expired_free_messages: {
        Args: { _batch_size?: number }
        Returns: number
      }
      send_compliment: {
        Args: { _recipient: string; _tag: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "student" | "mentor" | "admin"
      report_target: "post" | "message" | "user"
      request_status: "pending" | "approved" | "rejected"
      sub_tier: "free" | "mid" | "full"
      swipe_action: "like" | "pass" | "super_like"
      user_gender: "male" | "female"
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
      app_role: ["student", "mentor", "admin"],
      report_target: ["post", "message", "user"],
      request_status: ["pending", "approved", "rejected"],
      sub_tier: ["free", "mid", "full"],
      swipe_action: ["like", "pass", "super_like"],
      user_gender: ["male", "female"],
    },
  },
} as const
