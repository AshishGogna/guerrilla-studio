/**
 * Email sending via Brevo (formerly Sendinblue) API.
 * Requires BREVO_API_KEY and EMAIL_FROM in environment.
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  /** Plain-text body of the email. */
  body: string;
}

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Send an email using Brevo transactional API (plain text).
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { to, subject, body } = options;
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM ?? "me@gogna.xyz";

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not set");
  }

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: from, name: from.split("@")[0] },
      to: [{ email: to }],
      subject,
      textContent: body,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${err}`);
  }
}
