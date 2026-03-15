import { NextResponse } from "next/server";
import path from "path";
import { readFile } from "fs/promises";
import { sendEmail } from "@/lib/emailer";

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function POST(request: Request) {
  let payload: {
    to?: string;
    subject?: string;
    body?: string;
    attachmentPaths?: string[];
  };
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
  const attachmentPaths = Array.isArray(payload.attachmentPaths)
    ? payload.attachmentPaths.filter((p): p is string =>
        typeof p === "string" &&
        (p.startsWith("/editor-saves/") || p.startsWith("/projects/"))
      )
    : [];

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

  const attachments: { name: string; content: string; type: string }[] = [];
  const publicDir = path.join(process.cwd(), "public");
  for (const p of attachmentPaths) {
    try {
      const fullPath = path.join(publicDir, p.replace(/^\//, ""));
      const buffer = await readFile(fullPath);
      const content = buffer.toString("base64");
      const name = path.basename(p);
      const ext = path.extname(p).toLowerCase();
      const type = MIME_BY_EXT[ext] ?? "application/octet-stream";
      attachments.push({ name, content, type });
    } catch (e) {
      console.error("[send-email] Failed to read attachment:", p, e);
    }
  }

  try {
    await sendEmail({ to, subject, body, attachments });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
