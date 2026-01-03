import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForToken } from "@/lib/integrations/notion";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    console.error("Notion OAuth error:", error);
    return NextResponse.redirect(`${APP_URL}/settings?error=notion_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/settings?error=notion_invalid`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${APP_URL}/login`);
  }

  // Verify state
  const { data: integration } = await supabase
    .from("zeroed_integrations")
    .select("settings")
    .eq("user_id", user.id)
    .eq("provider", "notion")
    .single<{ settings: Record<string, unknown> | null }>();

  const settings = integration?.settings;
  const storedState = settings &&
    typeof settings === "object" &&
    !Array.isArray(settings)
      ? settings.oauth_state
      : null;

  if (storedState !== state) {
    return NextResponse.redirect(`${APP_URL}/settings?error=notion_state_mismatch`);
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeCodeForToken(code);

    // Store the integration
    await supabase.from("zeroed_integrations").upsert({
      user_id: user.id,
      provider: "notion",
      access_token: tokenData.access_token,
      sync_enabled: true,
      settings: {
        bot_id: tokenData.bot_id,
        workspace_id: tokenData.workspace_id,
        workspace_name: tokenData.workspace_name,
        workspace_icon: tokenData.workspace_icon,
        owner_type: tokenData.owner.type,
        owner_name: tokenData.owner.user?.name,
        owner_email: tokenData.owner.user?.person?.email,
      },
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,provider",
    });

    return NextResponse.redirect(`${APP_URL}/settings?success=notion_connected`);
  } catch (err) {
    console.error("Notion token exchange error:", err);
    return NextResponse.redirect(`${APP_URL}/settings?error=notion_token_failed`);
  }
}
