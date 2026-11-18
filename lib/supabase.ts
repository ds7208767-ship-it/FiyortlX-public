import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey)

if (!hasSupabaseConfig) {
  console.error('Supabase URL or publishable key is missing; using an inactive fallback client.')
}

const clientConfig = supabaseUrl && supabasePublishableKey
  ? { url: supabaseUrl, key: supabasePublishableKey }
  : {
      url: 'https://missing-supabase-configuration.invalid',
      key: 'missing-supabase-publishable-key',
    }

export const supabase = createBrowserClient(clientConfig.url, clientConfig.key)
