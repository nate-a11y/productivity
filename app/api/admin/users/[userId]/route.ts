import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";

// Suspend/unsuspend a user
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { userId } = await params;
  const { action } = await request.json();

  const adminClient = createServiceClient();

  if (action === "suspend") {
    // Ban user for 100 years (effectively permanent until manually unbanned)
    const banUntil = new Date();
    banUntil.setFullYear(banUntil.getFullYear() + 100);

    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: "876000h", // ~100 years in hours
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "User suspended" });
  }

  if (action === "unsuspend") {
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "User unsuspended" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// Delete a user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { userId } = await params;
  const adminClient = createServiceClient();

  // Delete user from auth (this should cascade to other tables via RLS/triggers)
  const { error } = await adminClient.auth.admin.deleteUser(userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: "User deleted" });
}
