import nodemailer from 'nodemailer';
import { env } from './env';

interface Credentials {
  user: string;
  pass: string;
}

let cachedPromise: Promise<Credentials> | null = null;

async function createEtherealAccount(): Promise<Credentials> {
  const account = await nodemailer.createTestAccount();
  console.log('[ethereal] test account created:', account.user);
  return { user: account.user, pass: account.pass };
}

export function getSmtpCredentials(): Promise<Credentials> {
  if (env.SMTP_USER && env.SMTP_PASS) {
    return Promise.resolve({ user: env.SMTP_USER, pass: env.SMTP_PASS });
  }
  if (!cachedPromise) {
    cachedPromise = createEtherealAccount().catch((error) => {
      cachedPromise = null;
      throw error;
    });
  }
  return cachedPromise;
}

export async function sendEmail(input: {
  to: string;
  from: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string; previewUrl: string | null }> {
  const credentials = await getSmtpCredentials();
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: credentials,
  });

  const info = await transporter.sendMail({
    from: `"${env.SMTP_FROM_NAME}" <${input.from}>`,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info) || null,
  };
}
