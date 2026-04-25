import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { localDb } from './localDb.js'

let supabase: any

if (config.localDb) {
  supabase = localDb
  console.log('📁 Using local file-based storage (set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to switch to Supabase)')
} else {
  supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey)
}

export { supabase }
export default supabase
