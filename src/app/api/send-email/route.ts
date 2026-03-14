import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/emailer";

export async function POST(request: Request) {
  let body: { to?: string; subject?: string; bodyHtml?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";

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
    await sendEmail({ to, subject, bodyHtml });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
