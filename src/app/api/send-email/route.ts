import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/emailer";

export async function POST(request: Request) {
  let payload: { to?: string; subject?: string; body?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const to = typeof payload.to === "string" ? payload.to.trim() : "";
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  if (!to) {
    return NextResponse.json(
      { error: "Missing or invalid 'to' email address" },
      { status: 400 }
    );
  }
  if (!subject) {
    return NextResponse.json(
      { error: "Missing or invalid 'subject'" },
      { status: 400 }
    );
  }

  try {
    await sendEmail({ to, subject, body });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
