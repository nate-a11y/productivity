import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export interface SyncError {
  message: string;
  timestamp: string;
  provider: string;
  operation: string;
}

// Record a sync error for an integration
export async function recordSyncError(
  userId: string,
  provider: string,
  error: string,
  operation: string = "sync"
) {
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data: integration } = await supabase
      .from("zeroed_integrations")
      .select("settings")
      .eq("user_id", userId)
      .eq("provider", provider)
      .single();

    const currentSettings = (integration?.settings as Record<string, unknown>) || {};

    // Store the last error
    const syncError: SyncError = {
      message: error,
      timestamp: new Date().toISOString(),
      provider,
      operation,
    };

    await supabase
      .from("zeroed_integrations")
      .update({
        settings: {
          ...currentSettings,
          last_sync_error: syncError,
        },
      })
      .eq("user_id", userId)
      .eq("provider", provider);

    console.error(`Sync error recorded for ${provider}:`, error);
  } catch (err) {
    console.error("Failed to record sync error:", err);
  }
}

// Clear sync error for an integration
export async function clearSyncError(userId: string, provider: string) {
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data: integration } = await supabase
      .from("zeroed_integrations")
      .select("settings")
      .eq("user_id", userId)
      .eq("provider", provider)
      .single();

    const currentSettings = (integration?.settings as Record<string, unknown>) || {};

    // Remove the error
    const { last_sync_error: _, ...restSettings } = currentSettings;

    await supabase
      .from("zeroed_integrations")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ settings: restSettings as any })
      .eq("user_id", userId)
      .eq("provider", provider);
  } catch (err) {
    console.error("Failed to clear sync error:", err);
  }
}
