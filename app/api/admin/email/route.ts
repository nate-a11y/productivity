import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { sendEmail } from "@/lib/email/resend";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { to, subject, message } = await request.json();

  if (!to || !subject || !message) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    await sendEmail({
      to,
      subject,
      html: `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="white-space: pre-wrap; line-height: 1.6;">${message.replace(/\n/g, '<br>')}</div>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
          <p style="color: #6b7280; font-size: 14px;">
            Sent from Bruh Admin
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to send email:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
