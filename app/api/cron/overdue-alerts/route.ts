import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSlackDM, sendSlackMessage, SlackBlock } from "@/lib/integrations/slack";
import { format, differenceInDays } from "date-fns";

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
    const today = format(new Date(), "yyyy-MM-dd");
    let sent = 0;
    let errors = 0;

    // Get all users with Slack integration enabled for overdue alerts
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
      if (!settings?.notify_overdue) {
        continue;
      }

      if (!integration.access_token) {
        continue;
      }

      try {
        // Get overdue tasks for this user
        const { data: overdueTasks } = await supabase
          .from("zeroed_tasks")
          .select("id, title, due_date")
          .eq("user_id", integration.user_id)
          .lt("due_date", today)
          .in("status", ["pending", "in_progress"])
          .order("due_date", { ascending: true })
          .limit(10);

        if (!overdueTasks || overdueTasks.length === 0) {
          continue; // No overdue tasks
        }

        // Get user's display name
        const { data: prefs } = await supabase
          .from("zeroed_user_preferences")
          .select("display_name")
          .eq("user_id", integration.user_id)
          .single();

        const greeting = prefs?.display_name
          ? `Hey ${prefs.display_name}`
          : "Hey";

        const taskList = overdueTasks
          .map((t) => {
            const daysOverdue = differenceInDays(new Date(), new Date(t.due_date!));
            return `• ${t.title} (${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue)`;
          })
          .join("\n");

        const blocks: SlackBlock[] = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⚠️ *${greeting}, you have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}*`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: taskList,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "_Complete these or reschedule them to clear your backlog_",
            },
          },
        ];

        await sendNotification(
          integration.access_token,
          settings,
          `You have ${overdueTasks.length} overdue tasks`,
          blocks
        );

        sent++;
      } catch (error) {
        console.error(`Failed to send overdue alert to user ${integration.user_id}:`, error);
        errors++;
      }
    }

    return NextResponse.json({
      message: "Overdue alerts sent",
      sent,
      errors,
    });
  } catch (error) {
    console.error("Overdue alerts cron error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
