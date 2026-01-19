export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            workspaces: {
                Row: {
                    id: string
                    created_at: string
                    name: string
                    type: string
                    tier: string
                    owner_id: string
                    enabled_tools: string[] | null
                }
                Insert: {
                    id?: string
                    created_at?: string
                    name: string
                    type?: string
                    tier?: string
                    owner_id: string
                    enabled_tools?: string[] | null
                }
                Update: {
                    id?: string
                    created_at?: string
                    name?: string
                    type?: string
                    tier?: string
                    owner_id?: string
                    enabled_tools?: string[] | null
                }
            }
            workspace_members: {
                Row: {
                    id: string
                    created_at: string
                    workspace_id: string
                    user_id: string
                    role: string
                }
                Insert: {
                    id?: string
                    created_at?: string
                    workspace_id: string
                    user_id: string
                    role?: string
                }
                Update: {
                    id?: string
                    created_at?: string
                    workspace_id?: string
                    user_id?: string
                    role?: string
                }
            }
        }
    }
}
