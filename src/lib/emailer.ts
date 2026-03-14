/**
 * Email sending via Brevo (formerly Sendinblue) API.
 * Requires BREVO_API_KEY and EMAIL_FROM in environment.
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  /** HTML body of the email. */
  bodyHtml: string;
}

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Send an email using Brevo transactional API.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {

  const { to, subject, bodyHtml } = options;

  // const apiKey = process.env.BREVO_API_KEY;
  // const from = process.env.EMAIL_FROM ?? "me@gogna.xyz";

  // if (!apiKey) {
  //   throw new Error("BREVO_API_KEY is not set");
  // }

  // const res = await fetch(BREVO_API_URL, {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     "api-key": apiKey,
  //   },
  //   body: JSON.stringify({
  //     sender: { email: from, name: from.split("@")[0] },
  //     to: [{ email: to }],
  //     subject,
  //     htmlContent: bodyHtml,
  //   }),
  // });

  // if (!res.ok) {
  //   const err = await res.text();
  //   throw new Error(`Brevo API error ${res.status}: ${err}`);
  // }
}
