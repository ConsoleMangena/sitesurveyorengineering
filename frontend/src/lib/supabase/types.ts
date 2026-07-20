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
      asset_calibrations: {
        Row: {
          asset_id: string
          calibration_date: string
          calibration_status: Database["public"]["Enums"]["calibration_status"]
          certificate_number: string | null
          certificate_path: string | null
          created_at: string
          created_by: string | null
          id: string
          next_calibration_date: string | null
          notes: string | null
          provider_name: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          asset_id: string
          calibration_date: string
          calibration_status?: Database["public"]["Enums"]["calibration_status"]
          certificate_number?: string | null
          certificate_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          next_calibration_date?: string | null
          notes?: string | null
          provider_name?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          asset_id?: string
          calibration_date?: string
          calibration_status?: Database["public"]["Enums"]["calibration_status"]
          certificate_number?: string | null
          certificate_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          next_calibration_date?: string | null
          notes?: string | null
          provider_name?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_calibrations_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_calibrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_maintenance_events: {
        Row: {
          asset_id: string
          cost: number
          created_at: string
          created_by: string | null
          description: string
          id: string
          provider_name: string | null
          serviced_on: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          asset_id: string
          cost?: number
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          provider_name?: string | null
          serviced_on: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          asset_id?: string
          cost?: number
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          provider_name?: string | null
          serviced_on?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_maintenance_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_maintenance_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          archived_at: string | null
          asset_code: string | null
          category: string | null
          created_at: string
          created_by: string | null
          current_value: number | null
          id: string
          kind: Database["public"]["Enums"]["asset_kind"]
          make: string | null
          metadata: Json
          model: string | null
          name: string
          purchase_cost: number | null
          purchase_date: string | null
          serial_number: string | null
          status: Database["public"]["Enums"]["asset_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          asset_code?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_value?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["asset_kind"]
          make?: string | null
          metadata?: Json
          model?: string | null
          name: string
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          asset_code?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          current_value?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["asset_kind"]
          make?: string | null
          metadata?: Json
          model?: string | null
          name?: string
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          anchored_at: string | null
          bucket_name: string
          chain_network: string | null
          chain_program_address: string | null
          chain_status: Database["public"]["Enums"]["attachment_chain_status"]
          chain_tx_signature: string | null
          content_hash: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          entity_id: string
          entity_table: string
          folder_id: string | null
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          storage_tier: Database["public"]["Enums"]["attachment_storage_tier"]
          updated_at: string
          uploaded_by: string | null
          visibility: Database["public"]["Enums"]["attachment_visibility"]
          workspace_id: string
        }
        Insert: {
          anchored_at?: string | null
          bucket_name: string
          chain_network?: string | null
          chain_program_address?: string | null
          chain_status?: Database["public"]["Enums"]["attachment_chain_status"]
          chain_tx_signature?: string | null
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          entity_id: string
          entity_table: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          storage_tier?: Database["public"]["Enums"]["attachment_storage_tier"]
          updated_at?: string
          uploaded_by?: string | null
          visibility?: Database["public"]["Enums"]["attachment_visibility"]
          workspace_id: string
        }
        Update: {
          anchored_at?: string | null
          bucket_name?: string
          chain_network?: string | null
          chain_program_address?: string | null
          chain_status?: Database["public"]["Enums"]["attachment_chain_status"]
          chain_tx_signature?: string | null
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          entity_id?: string
          entity_table?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          storage_tier?: Database["public"]["Enums"]["attachment_storage_tier"]
          updated_at?: string
          uploaded_by?: string | null
          visibility?: Database["public"]["Enums"]["attachment_visibility"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_tags: {
        Row: {
          attachment_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          attachment_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          attachment_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_tags_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_versions: {
        Row: {
          attachment_id: string
          content_hash: string | null
          created_at: string
          created_by: string | null
          id: string
          size_bytes: number | null
          storage_path: string
          workspace_id: string
        }
        Insert: {
          attachment_id: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          size_bytes?: number | null
          storage_path: string
          workspace_id: string
        }
        Update: {
          attachment_id?: string
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          size_bytes?: number | null
          storage_path?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_versions_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          archived_at: string | null
          contact_type: string | null
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          last_contact_at: string | null
          notes: string | null
          organization_id: string | null
          phone: string | null
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          contact_type?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          contact_type?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          organization_id?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_entries: {
        Row: {
          amount: number
          category: string
          created_at: string
          entry_date: string
          id: string
          notes: string | null
          project_id: string | null
          reimbursable: boolean
          updated_at: string
          user_id: string
          vendor: string | null
          workspace_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          entry_date: string
          id?: string
          notes?: string | null
          project_id?: string | null
          reimbursable?: boolean
          updated_at?: string
          user_id: string
          vendor?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          entry_date?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          reimbursable?: boolean
          updated_at?: string
          user_id?: string
          vendor?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          path: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          path?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          path?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_number: number
          qty: number
          rate: number
          unit: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_number?: number
          qty?: number
          rate?: number
          unit?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_number?: number
          qty?: number
          rate?: number
          unit?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          due_date: string | null
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          organization_id: string | null
          paid_at: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_total: number
          total: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          due_date?: string | null
          id?: string
          invoice_number: string
          issue_date?: string
          notes?: string | null
          organization_id?: string | null
          paid_at?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          notes?: string | null
          organization_id?: string | null
          paid_at?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignment_assets: {
        Row: {
          asset_id: string
          assignment_id: string
          created_at: string
          id: string
          workspace_id: string
        }
        Insert: {
          asset_id: string
          assignment_id: string
          created_at?: string
          id?: string
          workspace_id: string
        }
        Update: {
          asset_id?: string
          assignment_id?: string
          created_at?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignment_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignment_assets_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignment_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignment_members: {
        Row: {
          assignment_id: string
          assignment_role: string | null
          created_at: string
          id: string
          workspace_id: string
          workspace_member_id: string
        }
        Insert: {
          assignment_id: string
          assignment_role?: string | null
          created_at?: string
          id?: string
          workspace_id: string
          workspace_member_id: string
        }
        Update: {
          assignment_id?: string
          assignment_role?: string | null
          created_at?: string
          id?: string
          workspace_id?: string
          workspace_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignment_members_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignment_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignment_members_workspace_member_id_fkey"
            columns: ["workspace_member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignments: {
        Row: {
          assignment_date: string
          created_at: string
          created_by: string | null
          id: string
          job_id: string | null
          notes: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignment_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignment_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          notes?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      job_events: {
        Row: {
          created_at: string
          created_by: string | null
          end_time: string | null
          event_date: string
          event_type: string
          id: string
          job_id: string | null
          location: string | null
          notes: string | null
          project_id: string | null
          start_time: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          event_date: string
          event_type?: string
          id?: string
          job_id?: string | null
          location?: string | null
          notes?: string | null
          project_id?: string | null
          start_time?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          event_date?: string
          event_type?: string
          id?: string
          job_id?: string | null
          location?: string | null
          notes?: string | null
          project_id?: string | null
          start_time?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          job_type: string | null
          location: string | null
          project_id: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_type?: string | null
          location?: string | null
          project_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_type?: string | null
          location?: string | null
          project_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      license_events: {
        Row: {
          changed_by: string | null
          created_at: string
          id: number
          new_status: Database["public"]["Enums"]["license_status"] | null
          new_tier: Database["public"]["Enums"]["license_tier"] | null
          notes: string | null
          previous_status: Database["public"]["Enums"]["license_status"] | null
          previous_tier: Database["public"]["Enums"]["license_tier"] | null
          workspace_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: never
          new_status?: Database["public"]["Enums"]["license_status"] | null
          new_tier?: Database["public"]["Enums"]["license_tier"] | null
          notes?: string | null
          previous_status?: Database["public"]["Enums"]["license_status"] | null
          previous_tier?: Database["public"]["Enums"]["license_tier"] | null
          workspace_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: never
          new_status?: Database["public"]["Enums"]["license_status"] | null
          new_tier?: Database["public"]["Enums"]["license_tier"] | null
          notes?: string | null
          previous_status?: Database["public"]["Enums"]["license_status"] | null
          previous_tier?: Database["public"]["Enums"]["license_tier"] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "license_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          asset_id: string | null
          condition: string
          created_at: string
          currency: string
          description: string | null
          id: string
          is_global: boolean
          listing_type: string
          location: string
          name: string
          price: number
          seller: string
          specs: string[] | null
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          asset_id?: string | null
          condition: string
          created_at?: string
          currency: string
          description?: string | null
          id?: string
          is_global?: boolean
          listing_type?: string
          location: string
          name: string
          price: number
          seller: string
          specs?: string[] | null
          type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          asset_id?: string | null
          condition?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_global?: boolean
          listing_type?: string
          location?: string
          name?: string
          price?: number
          seller?: string
          specs?: string[] | null
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_requests: {
        Row: {
          id: string
          listing_id: string
          requester_workspace_id: string
          requester_user_id: string
          status: string
          message: string | null
          desired_start_date: string | null
          desired_end_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          listing_id: string
          requester_workspace_id: string
          requester_user_id: string
          status?: string
          message?: string | null
          desired_start_date?: string | null
          desired_end_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          listing_id?: string
          requester_workspace_id?: string
          requester_user_id?: string
          status?: string
          message?: string | null
          desired_start_date?: string | null
          desired_end_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_requests_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_requests_requester_workspace_id_fkey"
            columns: ["requester_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_orders: {
        Row: {
          amount: number
          buyer_workspace_id: string
          created_at: string
          currency: string
          external_payment_ref: string | null
          id: string
          listing_id: string
          listing_workspace_id: string
          metadata: Json
          payment_status: string
          platform_fee_amount: number
          provider: string
          updated_at: string
        }
        Insert: {
          amount: number
          buyer_workspace_id: string
          created_at?: string
          currency: string
          external_payment_ref?: string | null
          id?: string
          listing_id: string
          listing_workspace_id: string
          metadata?: Json
          payment_status?: string
          platform_fee_amount?: number
          provider?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          buyer_workspace_id?: string
          created_at?: string
          currency?: string
          external_payment_ref?: string | null
          id?: string
          listing_id?: string
          listing_workspace_id?: string
          metadata?: Json
          payment_status?: string
          platform_fee_amount?: number
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_orders_buyer_workspace_id_fkey"
            columns: ["buyer_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_listing_workspace_id_fkey"
            columns: ["listing_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json
          read_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          archived_at: string | null
          city: string | null
          country_code: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_type: Database["public"]["Enums"]["organization_type"]
          phone: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_type?: Database["public"]["Enums"]["organization_type"]
          phone?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          city?: string | null
          country_code?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_type?: Database["public"]["Enums"]["organization_type"]
          phone?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          created_by: string | null
          detail: string
          expiry: string | null
          holder: string | null
          id: string
          is_default: boolean
          label: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          detail: string
          expiry?: string | null
          holder?: string | null
          id?: string
          is_default?: boolean
          label: string
          type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          detail?: string
          expiry?: string | null
          holder?: string | null
          id?: string
          is_default?: boolean
          label?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          chain: string | null
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          notes: string | null
          paid_on: string
          payment_method: string | null
          reference: string | null
          token_mint: string | null
          tx_signature: string | null
          updated_at: string
          wallet_address: string | null
          workspace_id: string
        }
        Insert: {
          amount: number
          chain?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          paid_on?: string
          payment_method?: string | null
          reference?: string | null
          token_mint?: string | null
          tx_signature?: string | null
          updated_at?: string
          wallet_address?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          chain?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          paid_on?: string
          payment_method?: string | null
          reference?: string | null
          token_mint?: string | null
          tx_signature?: string | null
          updated_at?: string
          wallet_address?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          availability: string
          bio: string | null
          certifications: string[] | null
          created_at: string
          currency: string
          discipline: string
          experience: string
          id: string
          is_global: boolean
          location: string
          name: string
          rate: number
          rate_per: string
          rating: number | null
          reviews: number | null
          skills: string[] | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          availability: string
          bio?: string | null
          certifications?: string[] | null
          created_at?: string
          currency: string
          discipline: string
          experience: string
          id?: string
          is_global?: boolean
          location: string
          name: string
          rate: number
          rate_per: string
          rating?: number | null
          reviews?: number | null
          skills?: string[] | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          availability?: string
          bio?: string | null
          certifications?: string[] | null
          created_at?: string
          currency?: string
          discipline?: string
          experience?: string
          id?: string
          is_global?: boolean
          location?: string
          name?: string
          rate?: number
          rate_per?: string
          rating?: number | null
          reviews?: number | null
          skills?: string[] | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professionals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_signup_account_type: string | null
          avatar_path: string | null
          bio: string | null
          created_at: string
          default_workspace_id: string | null
          email: string | null
          full_name: string | null
          id: string
          is_platform_admin: boolean
          onboarding_complete: boolean
          phone: string | null
          professional_title: string | null
          promo_code: string | null
          updated_at: string
        }
        Insert: {
          auth_signup_account_type?: string | null
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          default_workspace_id?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_platform_admin?: boolean
          onboarding_complete?: boolean
          phone?: string | null
          professional_title?: string | null
          promo_code?: string | null
          updated_at?: string
        }
        Update: {
          auth_signup_account_type?: string | null
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          default_workspace_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_platform_admin?: boolean
          onboarding_complete?: boolean
          phone?: string | null
          professional_title?: string | null
          promo_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_workspace_id_fkey"
            columns: ["default_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_activities: {
        Row: {
          activity_type: string
          content: string
          created_at: string
          id: string
          project_id: string
          user_id: string | null
        }
        Insert: {
          activity_type?: string
          content: string
          created_at?: string
          id?: string
          project_id: string
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_cad_drawings: {
        Row: {
          created_at: string
          model: Json
          project_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          model?: Json
          project_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          model?: Json
          project_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cad_drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cad_drawings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_contacts: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          project_id: string
          relation: string | null
          workspace_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          project_id: string
          relation?: string | null
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          project_id?: string
          relation?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          datum: string | null
          description: string | null
          ends_on: string | null
          id: string
          name: string
          organization_id: string | null
          phase: string | null
          points: number
          progress: number
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          datum?: string | null
          description?: string | null
          ends_on?: string | null
          id?: string
          name: string
          organization_id?: string | null
          phase?: string | null
          points?: number
          progress?: number
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          datum?: string | null
          description?: string | null
          ends_on?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          phase?: string | null
          points?: number
          progress?: number
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_code_rules: {
        Row: {
          active: boolean
          asset_cap_boost: number
          code: string
          project_cap_boost: number
          seat_bonus: number
          signup_license_status:
            | Database["public"]["Enums"]["license_status"]
            | null
          signup_tier: Database["public"]["Enums"]["license_tier"] | null
          trial_days: number | null
        }
        Insert: {
          active?: boolean
          asset_cap_boost?: number
          code: string
          project_cap_boost?: number
          seat_bonus?: number
          signup_license_status?:
            | Database["public"]["Enums"]["license_status"]
            | null
          signup_tier?: Database["public"]["Enums"]["license_tier"] | null
          trial_days?: number | null
        }
        Update: {
          active?: boolean
          asset_cap_boost?: number
          code?: string
          project_cap_boost?: number
          seat_bonus?: number
          signup_license_status?:
            | Database["public"]["Enums"]["license_status"]
            | null
          signup_tier?: Database["public"]["Enums"]["license_tier"] | null
          trial_days?: number | null
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          created_at: string
          description: string
          id: string
          line_number: number
          qty: number
          quote_id: string
          rate: number
          unit: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          line_number?: number
          qty?: number
          quote_id: string
          rate?: number
          unit?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          line_number?: number
          qty?: number
          quote_id?: string
          rate?: number
          unit?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          expires_on: string | null
          id: string
          issue_date: string
          notes: string | null
          organization_id: string | null
          project_id: string | null
          quote_number: string
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          tax_total: number
          total: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          expires_on?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          organization_id?: string | null
          project_id?: string | null
          quote_number: string
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          expires_on?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          organization_id?: string | null
          project_id?: string | null
          quote_number?: string
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          billable: boolean
          created_at: string
          entry_date: string
          hours: number
          id: string
          notes: string | null
          project_id: string | null
          task: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          billable?: boolean
          created_at?: string
          entry_date: string
          hours: number
          id?: string
          notes?: string | null
          project_id?: string | null
          task: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          billable?: boolean
          created_at?: string
          entry_date?: string
          hours?: number
          id?: string
          notes?: string | null
          project_id?: string | null
          task?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invitation_token: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_member_role"]
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invitation_token?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_member_role"]
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invitation_token?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_member_role"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_licenses: {
        Row: {
          asset_cap: number | null
          created_at: string
          ends_at: string | null
          is_manual: boolean
          notes: string | null
          project_cap: number | null
          seat_limit: number | null
          starts_at: string
          status: Database["public"]["Enums"]["license_status"]
          storage_cap_bytes: number | null
          tier: Database["public"]["Enums"]["license_tier"]
          trial_ends_at: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          asset_cap?: number | null
          created_at?: string
          ends_at?: string | null
          is_manual?: boolean
          notes?: string | null
          project_cap?: number | null
          seat_limit?: number | null
          starts_at?: string
          status?: Database["public"]["Enums"]["license_status"]
          storage_cap_bytes?: number | null
          tier?: Database["public"]["Enums"]["license_tier"]
          trial_ends_at?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          asset_cap?: number | null
          created_at?: string
          ends_at?: string | null
          is_manual?: boolean
          notes?: string | null
          project_cap?: number | null
          seat_limit?: number | null
          starts_at?: string
          status?: Database["public"]["Enums"]["license_status"]
          storage_cap_bytes?: number | null
          tier?: Database["public"]["Enums"]["license_tier"]
          trial_ends_at?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_licenses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          invited_at: string | null
          joined_at: string | null
          role: Database["public"]["Enums"]["workspace_member_role"]
          status: Database["public"]["Enums"]["workspace_member_status"]
          title: string | null
          updated_at: string
          user_id: string
          work_email: string | null
          work_phone: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_at?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["workspace_member_role"]
          status?: Database["public"]["Enums"]["workspace_member_status"]
          title?: string | null
          updated_at?: string
          user_id: string
          work_email?: string | null
          work_phone?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_at?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["workspace_member_role"]
          status?: Database["public"]["Enums"]["workspace_member_status"]
          title?: string | null
          updated_at?: string
          user_id?: string
          work_email?: string | null
          work_phone?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          country_code: string
          created_at: string
          default_currency: string
          settings: Json
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          default_currency?: string
          settings?: Json
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          country_code?: string
          created_at?: string
          default_currency?: string
          settings?: Json
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          archived_at: string | null
          billing_email: string | null
          country_code: string
          created_at: string
          currency_code: string
          id: string
          name: string
          owner_user_id: string
          slug: string | null
          timezone: string
          type: Database["public"]["Enums"]["workspace_type"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          billing_email?: string | null
          country_code?: string
          created_at?: string
          currency_code?: string
          id?: string
          name: string
          owner_user_id: string
          slug?: string | null
          timezone?: string
          type: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          billing_email?: string | null
          country_code?: string
          created_at?: string
          currency_code?: string
          id?: string
          name?: string
          owner_user_id?: string
          slug?: string | null
          timezone?: string
          type?: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_workspace_invitation: {
        Args: { target_invitation_token: string }
        Returns: string
      }
      admin_list_audit_log: {
        Args: {
          p_action?: string
          p_limit?: number
          p_offset?: number
          p_workspace_id?: string
        }
        Returns: {
          action: string
          actor_user_id: string
          created_at: string
          details: Json
          entity_id: string
          entity_table: string
          id: number
          workspace_id: string
        }[]
      }
      admin_workspace_summary: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      apply_promo_code_to_workspace: {
        Args: { p_code: string; p_workspace_id: string }
        Returns: undefined
      }
      can_manage_assets: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_manage_business_operations: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_manage_business_workspace: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_manage_documents: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_manage_finance: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_manage_operations: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_manage_sales: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_manage_workspace: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      create_business_workspace: {
        Args: { workspace_name: string; workspace_slug?: string }
        Returns: string
      }
      get_workspace_license_tier: {
        Args: { target_workspace_id: string }
        Returns: Database["public"]["Enums"]["license_tier"]
      }
      get_workspace_usage: { Args: { p_workspace_id: string }; Returns: Json }
      has_workspace_role: {
        Args: {
          allowed_roles: Database["public"]["Enums"]["workspace_member_role"][]
          target_workspace_id: string
        }
        Returns: boolean
      }
      list_workspace_activity_log: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_workspace_id?: string
        }
        Returns: {
          action: string
          actor_user_id: string
          created_at: string
          details: Json
          entity_id: string
          entity_table: string
          id: number
          workspace_id: string
        }[]
      }
      log_activity: {
        Args: {
          p_action: string
          p_details?: Json
          p_entity_id?: string
          p_entity_table?: string
          p_workspace_id?: string
        }
        Returns: undefined
      }
      is_business_workspace: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_workspace_license_active: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      path_first_segment_uuid: { Args: { path: string }; Returns: string }
      set_default_payment_method: {
        Args: { p_method_id: string; p_workspace_id: string }
        Returns: undefined
      }
      set_default_workspace: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      shares_workspace_with_profile: {
        Args: { target_profile_id: string }
        Returns: boolean
      }
      slugify: { Args: { value: string }; Returns: string }
      workspace_active_project_count: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      workspace_has_tier: {
        Args: {
          minimum_tier: Database["public"]["Enums"]["license_tier"]
          target_workspace_id: string
        }
        Returns: boolean
      }
      workspace_occupied_seats: {
        Args: { p_workspace_id: string }
        Returns: number
      }
    }
    Enums: {
      asset_kind: "instrument" | "vehicle" | "equipment" | "other"
      asset_status: "available" | "deployed" | "maintenance" | "retired"
      assignment_status:
        | "draft"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
      attachment_chain_status: "none" | "pending" | "anchored" | "failed"
      attachment_storage_tier: "off_chain" | "on_chain"
      attachment_visibility: "private" | "workspace" | "public"
      calibration_status: "scheduled" | "passed" | "failed" | "expired"
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "cancelled"
      job_status:
        | "planned"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
      license_status:
        | "trialing"
        | "active"
        | "past_due"
        | "suspended"
        | "cancelled"
      license_tier: "free" | "pro" | "enterprise"
      notification_status: "unread" | "read" | "archived"
      organization_type:
        | "client"
        | "vendor"
        | "government"
        | "partner"
        | "lead"
        | "subcontractor"
      project_status: "draft" | "active" | "completed" | "on_hold" | "archived"
      quote_status: "draft" | "sent" | "accepted" | "rejected" | "expired"
      workspace_member_role:
        | "owner"
        | "admin"
        | "ops_manager"
        | "finance"
        | "sales"
        | "technician"
        | "viewer"
      workspace_member_status: "active" | "invited" | "suspended"
      workspace_type: "personal" | "business"
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
      asset_kind: ["instrument", "vehicle", "equipment", "other"],
      asset_status: ["available", "deployed", "maintenance", "retired"],
      assignment_status: [
        "draft",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
      ],
      attachment_visibility: ["private", "workspace", "public"],
      calibration_status: ["scheduled", "passed", "failed", "expired"],
      invoice_status: ["draft", "sent", "paid", "overdue", "cancelled"],
      job_status: [
        "planned",
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
      ],
      license_status: [
        "trialing",
        "active",
        "past_due",
        "suspended",
        "cancelled",
      ],
      license_tier: ["free", "pro", "enterprise"],
      notification_status: ["unread", "read", "archived"],
      organization_type: [
        "client",
        "vendor",
        "government",
        "partner",
        "lead",
        "subcontractor",
      ],
      project_status: ["draft", "active", "completed", "on_hold", "archived"],
      quote_status: ["draft", "sent", "accepted", "rejected", "expired"],
      workspace_member_role: [
        "owner",
        "admin",
        "ops_manager",
        "finance",
        "sales",
        "technician",
        "viewer",
      ],
      workspace_member_status: ["active", "invited", "suspended"],
      workspace_type: ["personal", "business"],
    },
  },
} as const
