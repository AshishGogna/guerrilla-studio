/**
 * Email sending. Actual delivery to be implemented later.
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  /** HTML body of the email. */
  bodyHtml: string;
}

/**
 * Send an email. Does not send yet; implementation pending.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { to, subject, bodyHtml } = options;
  // TODO: implement actual sending (e.g. API route + SMTP or transactional provider)
  // eslint-disable-next-line no-console
  console.log("[emailer] sendEmail called", { to, subject, bodyLength: bodyHtml.length });
}
