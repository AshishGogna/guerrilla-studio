/**
 * Email sending via Brevo (formerly Sendinblue) API.
 * Requires BREVO_API_KEY and EMAIL_FROM in environment.
 */

export interface EmailAttachment {
  name: string;
  /** Base64-encoded content. */
  content: string;
  type: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  /** Plain-text body of the email. */
  body: string;
  /** Optional attachments (base64 content). */
  attachments?: EmailAttachment[];
}

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Send an email using Brevo transactional API (plain text, optional attachments).
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { to, subject, body, attachments = [] } = options;
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM ?? "me@gogna.xyz";

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not set");
  }

  const payload: {
    sender: { email: string; name: string };
    to: { email: string }[];
    subject: string;
    textContent: string;
    attachment?: { name: string; content: string; type: string }[];
  } = {
    sender: { email: from, name: from.split("@")[0] },
    to: [{ email: to }],
    subject,
    textContent: body,
  };
  if (attachments.length > 0) {
    payload.attachment = attachments.map((a) => ({
      name: a.name,
      content: a.content,
      type: a.type,
    }));
  }

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${err}`);
  }
}
