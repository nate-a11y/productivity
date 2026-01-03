import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSlackDM, sendSlackMessage, SlackBlock } from "@/lib/integrations/slack";
import { startOfWeek, endOfWeek, subWeeks, format } from "date-fns";

// Send notification to configured channel or DM
async function sendNotification(
  accessToken: string,
  settings: Record<string, unknown>,
  text: string,
  blocks?: SlackBlock[]
) {
  const channelId = settings?.notification_channel_id as string | undefined;
  const slackUserId = settings?.slack_user_id as string | undefined;

  if (channelId && channelId !== "dm") {
    return sendSlackMessage(accessToken, { channel: channelId, text, blocks });
  } else if (slackUserId) {
    return sendSlackDM(accessToken, slackUserId, text, blocks);
  }
  return { ok: false, error: "No destination configured" };
}

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get last week's date range
    const lastWeekStart = format(startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const lastWeekEnd = format(endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }), "yyyy-MM-dd");

    let sent = 0;
    let errors = 0;

    // Get all users with Slack integration enabled for weekly summary
    const { data: integrations } = await supabase
      .from("zeroed_integrations")
      .select("user_id, access_token, settings")
      .eq("provider", "slack")
      .eq("sync_enabled", true);

    if (!integrations || integrations.length === 0) {
      return NextResponse.json({ message: "No integrations to process", sent: 0 });
    }

    for (const integration of integrations) {
      const settings = integration.settings as Record<string, unknown> | null;
      if (!settings?.notify_weekly_summary) {
        continue;
      }

      if (!integration.access_token) {
        continue;
      }

      try {
        // Get user's display name
        const { data: prefs } = await supabase
          .from("zeroed_user_preferences")
          .select("display_name, streak_current")
          .eq("user_id", integration.user_id)
          .single();

        // Get last week's stats
        const { data: tasks } = await supabase
          .from("zeroed_tasks")
          .select("id, status, completed_at")
          .eq("user_id", integration.user_id)
          .gte("completed_at", lastWeekStart)
          .lte("completed_at", lastWeekEnd);

        const { data: focusSessions } = await supabase
          .from("zeroed_focus_sessions")
          .select("duration_minutes")
          .eq("user_id", integration.user_id)
          .eq("completed", true)
          .gte("created_at", lastWeekStart)
          .lte("created_at", lastWeekEnd);

        const completedTasks = tasks?.length || 0;
        const totalFocusMinutes = focusSessions?.reduce((acc, s) => acc + (s.duration_minutes || 0), 0) || 0;
        const focusHours = Math.floor(totalFocusMinutes / 60);
        const focusMins = totalFocusMinutes % 60;
        const streak = prefs?.streak_current || 0;

        const greeting = prefs?.display_name
          ? `Happy Monday ${prefs.display_name}!`
          : "Happy Monday!";

        const blocks: SlackBlock[] = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📊 *Weekly Recap*\n${greeting} Here's how last week went:`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Tasks Completed*\n${completedTasks} tasks ✅`,
              },
              {
                type: "mrkdwn",
                text: `*Focus Time*\n${focusHours}h ${focusMins}m ⏱️`,
              },
              {
                type: "mrkdwn",
                text: `*Current Streak*\n${streak} days 🔥`,
              },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `_Week of ${lastWeekStart} to ${lastWeekEnd}_`,
            },
          },
        ];

        await sendNotification(
          integration.access_token,
          settings,
          `${greeting} Your weekly recap is ready.`,
          blocks
        );

        sent++;
      } catch (error) {
        console.error(`Failed to send weekly summary to user ${integration.user_id}:`, error);
        errors++;
      }
    }

    return NextResponse.json({
      message: "Weekly summaries sent",
      sent,
      errors,
    });
  } catch (error) {
    console.error("Weekly summary cron error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
