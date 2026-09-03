import { createClient } from "./supabase/client";

interface SignUpParams {
  email: string;
  password: string;
  username?: string;
}

export async function signUp({ email, password, username }: SignUpParams) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by a `profiles` insert trigger (once that table exists) to seed
      // the username from raw_user_meta_data.
      data: { username },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
  return data;
}

interface SignInParams {
  email: string;
  password: string;
}

export async function signIn({ email, password }: SignInParams) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
