import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, supabaseAnonKey } from './config.js'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
