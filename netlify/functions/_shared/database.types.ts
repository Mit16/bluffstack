export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      game_rooms: {
        Row: {
          room_code: string;
          state: Json;
          revision: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          room_code: string;
          state: Json;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          room_code?: string;
          state?: Json;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_game_room: {
        Args: {
          p_room_code: string;
          p_state: Json;
        };
        Returns: {
          created_room_code: string;
          current_revision: number;
          current_state: Json;
        }[];
      };
      save_game_room_state: {
        Args: {
          p_room_code: string;
          p_expected_revision: number;
          p_state: Json;
        };
        Returns: {
          saved_revision: number;
          saved_state: Json;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
