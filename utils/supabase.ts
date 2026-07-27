import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://fnysbiwhwcqqqdwvhkau.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZueXNiaXdod2NxcXFkd3Zoa2F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNzEwMzMsImV4cCI6MjA5ODg0NzAzM30.M51XDvjdeVW1FtSb__P9yU8eIHyZ7jH85CibLWHaVek';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },

  
});