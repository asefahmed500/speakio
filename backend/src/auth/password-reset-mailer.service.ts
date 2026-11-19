import { Injectable, Logger } from '@nestjs/common';

/**
 * Transactional password-reset email. Production uses Cloudflare Email
 * Sending REST (Bearer token + onboarded from-domain). Development logs the
 * link so the flow can be tested without an email account — never log the
 * link in production.
 */
@Injectable()
export class PasswordResetMailer {
  private readonly logger = new Logger(PasswordResetMailer.name);

  async send(to: string, resetUrl: string): Promise<void> {
    const token = process.env.CF_EMAIL_API_TOKEN;
    const accountId = process.env.CF_ACCOUNT_ID;
    const from = process.env.CF_EMAIL_FROM;

    if (token && accountId && from) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to,
            from,
            subject: 'Reset your Speakio password',
            text: `Open this link to choose a new password (valid 30 minutes):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
            html: `<p>Open this link to choose a new password (valid 30 minutes):</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`,
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) {
        const body = (await response.text()).slice(0, 200);
        throw new Error(`Email delivery failed (${response.status}): ${body}`);
      }
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Password reset email is not configured (CF_EMAIL_API_TOKEN, CF_ACCOUNT_ID, CF_EMAIL_FROM)',
      );
    }
    this.logger.warn(`[DEV] Password reset link for ${to}: ${resetUrl}`);
  }
}
