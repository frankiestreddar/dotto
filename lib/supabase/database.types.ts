export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      canvas_collaborations: {
        Row: {
          collaborator_id: string;
          created_at: string;
          folder_id: string;
          folder_title: string;
          id: number;
          owner_id: string;
          responded_at: string | null;
          status: string;
        };
        Insert: {
          collaborator_id: string;
          created_at?: string;
          folder_id: string;
          folder_title?: string;
          id?: never;
          owner_id: string;
          responded_at?: string | null;
          status?: string;
        };
        Update: {
          collaborator_id?: string;
          created_at?: string;
          folder_id?: string;
          folder_title?: string;
          id?: never;
          owner_id?: string;
          responded_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "canvas_collaborations_collaborator_id_fkey";
            columns: ["collaborator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "canvas_collaborations_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      demo_sessions: {
        Row: {
          created_at: string;
          duration_ms: number;
          id: string;
          title: string;
          user_id: string;
          video_url: string | null;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number;
          id?: string;
          title?: string;
          user_id: string;
          video_url?: string | null;
        };
        Update: {
          created_at?: string;
          duration_ms?: number;
          id?: string;
          title?: string;
          user_id?: string;
          video_url?: string | null;
        };
        Relationships: [];
      };
      dotbot_conversations: {
        Row: {
          conversation_summary: string | null;
          created_at: string;
          id: string;
          owner_id: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          conversation_summary?: string | null;
          created_at?: string;
          id?: string;
          owner_id: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          conversation_summary?: string | null;
          created_at?: string;
          id?: string;
          owner_id?: string;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dotbot_conversations_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      dotbot_messages: {
        Row: {
          content: Json;
          conversation_id: string;
          created_at: string;
          id: string;
          owner_id: string;
          role: string;
        };
        Insert: {
          content: Json;
          conversation_id: string;
          created_at?: string;
          id?: string;
          owner_id: string;
          role: string;
        };
        Update: {
          content?: Json;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          owner_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dotbot_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "dotbot_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dotbot_messages_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          addressee_id: string;
          created_at: string;
          id: string;
          requester_id: string;
          responded_at: string | null;
          status: string;
        };
        Insert: {
          addressee_id: string;
          created_at?: string;
          id?: string;
          requester_id: string;
          responded_at?: string | null;
          status?: string;
        };
        Update: {
          addressee_id?: string;
          created_at?: string;
          id?: string;
          requester_id?: string;
          responded_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey";
            columns: ["addressee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friendships_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      global_items: {
        Row: {
          created_at: string;
          folder_id: string;
          global_id: string;
          kind: string;
          owner_id: string;
          title: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          created_at?: string;
          folder_id: string;
          global_id: string;
          kind: string;
          owner_id: string;
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          created_at?: string;
          folder_id?: string;
          global_id?: string;
          kind?: string;
          owner_id?: string;
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      library_items: {
        Row: {
          acquired_at: string;
          id: string;
          listing_id: string;
          user_id: string;
        };
        Insert: {
          acquired_at?: string;
          id?: string;
          listing_id: string;
          user_id: string;
        };
        Update: {
          acquired_at?: string;
          id?: string;
          listing_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "library_items_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "marketplace_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "library_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      marketplace_listings: {
        Row: {
          content: Json;
          created_at: string;
          creator_id: string;
          description: string | null;
          id: string;
          price_label: string;
          published_at: string | null;
          status: string;
          tagline: string;
          title: string;
        };
        Insert: {
          content?: Json;
          created_at?: string;
          creator_id: string;
          description?: string | null;
          id?: string;
          price_label?: string;
          published_at?: string | null;
          status?: string;
          tagline?: string;
          title: string;
        };
        Update: {
          content?: Json;
          created_at?: string;
          creator_id?: string;
          description?: string | null;
          id?: string;
          price_label?: string;
          published_at?: string | null;
          status?: string;
          tagline?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string | null;
          canvas_snapshot: Json | null;
          created_at: string;
          friendship_id: string;
          id: string;
          sender_id: string;
        };
        Insert: {
          body?: string | null;
          canvas_snapshot?: Json | null;
          created_at?: string;
          friendship_id: string;
          id?: string;
          sender_id: string;
        };
        Update: {
          body?: string | null;
          canvas_snapshot?: Json | null;
          created_at?: string;
          friendship_id?: string;
          id?: string;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_friendship_id_fkey";
            columns: ["friendship_id"];
            isOneToOne: false;
            referencedRelation: "friendships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_config: Json | null;
          avatar_id: number;
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          dotbot_memory: string | null;
          generation_credits_remaining: number;
          generation_credits_reset_at: string;
          id: string;
          last_daily_bonus_at: string | null;
          last_login_at: string | null;
          level_number: number;
          login_streak: number;
          plan: string;
          search_credits_remaining: number;
          search_credits_reset_at: string;
          total_score: number;
          username: string;
        };
        Insert: {
          avatar_config?: Json | null;
          avatar_id?: number;
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          dotbot_memory?: string | null;
          generation_credits_remaining?: number;
          generation_credits_reset_at?: string;
          id: string;
          last_daily_bonus_at?: string | null;
          last_login_at?: string | null;
          level_number?: number;
          login_streak?: number;
          plan?: string;
          search_credits_remaining?: number;
          search_credits_reset_at?: string;
          total_score?: number;
          username: string;
        };
        Update: {
          avatar_config?: Json | null;
          avatar_id?: number;
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          dotbot_memory?: string | null;
          generation_credits_remaining?: number;
          generation_credits_reset_at?: string;
          id?: string;
          last_daily_bonus_at?: string | null;
          last_login_at?: string | null;
          level_number?: number;
          login_streak?: number;
          plan?: string;
          search_credits_remaining?: number;
          search_credits_reset_at?: string;
          total_score?: number;
          username?: string;
        };
        Relationships: [];
      };
      user_achievements: {
        Row: {
          achievement_id: string;
          unlocked_at: string;
          user_id: string;
        };
        Insert: {
          achievement_id: string;
          unlocked_at?: string;
          user_id: string;
        };
        Update: {
          achievement_id?: string;
          unlocked_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_point_events: {
        Row: {
          action_type: string;
          created_at: string;
          id: number;
          points: number;
          user_id: string;
        };
        Insert: {
          action_type: string;
          created_at?: string;
          id?: never;
          points: number;
          user_id: string;
        };
        Update: {
          action_type?: string;
          created_at?: string;
          id?: never;
          points?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      user_stat_counters: {
        Row: {
          count: number;
          stat_key: string;
          user_id: string;
        };
        Insert: {
          count?: number;
          stat_key: string;
          user_id: string;
        };
        Update: {
          count?: number;
          stat_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      waypoints: {
        Row: {
          created_at: string;
          creator_id: string;
          folder_id: string;
          id: string;
          item_id: string;
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          creator_id: string;
          folder_id: string;
          id?: string;
          item_id: string;
          name?: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          creator_id?: string;
          folder_id?: string;
          id?: string;
          item_id?: string;
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "waypoints_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "waypoints_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          current_folder_id: string | null;
          data: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          current_folder_id?: string | null;
          data: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          current_folder_id?: string | null;
          data?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      append_dotbot_turn: {
        Args: {
          p_assistant_content: Json;
          p_conversation_id: string;
          p_conversation_summary?: string;
          p_title: string;
          p_user_content: Json;
        };
        Returns: string;
      };
      award_daily_login_bonus: {
        Args: { p_points?: number; p_user_id: string };
        Returns: number;
      };
      award_user_points: {
        Args: { p_action_type: string; p_points: number; p_user_id: string };
        Returns: number;
      };
      bump_achievement_stat: {
        Args: {
          p_absolute?: boolean;
          p_achievement_id: string;
          p_delta?: number;
          p_stat_key: string;
          p_threshold: number;
          p_user_id: string;
        };
        Returns: {
          new_count: number;
          newly_unlocked: boolean;
        }[];
      };
      bump_login_streak: { Args: { p_user_id: string }; Returns: number };
      canvas_access_status: {
        Args: {
          p_collaborator_id: string;
          p_folder_id: string;
          p_owner_id: string;
        };
        Returns: string;
      };
      deduct_generation_credits: {
        Args: { p_amount: number };
        Returns: boolean;
      };
      deduct_search_credits: { Args: { p_amount: number }; Returns: boolean };
      delete_dotbot_conversations: {
        Args: { p_conversation_ids?: string[] };
        Returns: undefined;
      };
      get_effective_collaborators: {
        Args: { p_folder_id: string; p_owner_id: string };
        Returns: {
          collaborator_id: string;
        }[];
      };
      get_folder_ancestor_chain: {
        Args: { p_folder_id: string; p_owner_id: string };
        Returns: string[];
      };
      get_public_folder: {
        Args: { p_folder_id: string; p_owner_id: string };
        Returns: Json;
      };
      get_shared_folder: {
        Args: { p_folder_id: string; p_owner_id: string };
        Returns: Json;
      };
      is_username_available: {
        Args: { check_username: string };
        Returns: boolean;
      };
      jsonb_folder_parent: {
        Args: { p_folder_id: string; p_folders: Json };
        Returns: string;
      };
      leave_canvas_collaboration: { Args: { p_id: number }; Returns: undefined };
      register_global_items: { Args: { p_items: Json }; Returns: undefined };
      rename_canvas_collaborations: {
        Args: { p_folder_id: string; p_new_title: string; p_owner_id: string };
        Returns: undefined;
      };
      resolve_global_id: {
        Args: { p_global_id: string };
        Returns: {
          access: string;
          folder_id: string;
          kind: string;
          owner_id: string;
          title: string;
          visibility: string;
        }[];
      };
      respond_to_canvas_collaboration: {
        Args: { p_accept: boolean; p_id: number };
        Returns: undefined;
      };
      revoke_canvas_collaboration: {
        Args: { p_collaborator_id: string; p_folder_id: string };
        Returns: undefined;
      };
      search_accessible_by_name: {
        Args: { p_query: string };
        Returns: {
          folder_id: string;
          global_id: string;
          kind: string;
          owner_id: string;
          title: string;
        }[];
      };
      set_global_item_visibility: {
        Args: { p_folder_id: string; p_visibility: string };
        Returns: undefined;
      };
      update_dotbot_memory: { Args: { p_memory: string }; Returns: undefined };
      update_shared_folder: {
        Args: {
          p_folder_id: string;
          p_new_folder_data: Json;
          p_owner_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
