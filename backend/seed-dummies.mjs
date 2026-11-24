/* Rewrite the 3 dummy scheduled emails with full subject + body. Run: node seed-dummies.mjs */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const p = new PrismaClient();
const SENDER = 'manjimadutta42@gmail.com';

const DUMMIES = [
  {
    toEmail: 'hermionewitch12@gmil.com',
    subject: 'Welcome to the team, Hermione 👋',
    body: [
      'Hi Hermione,',
      '',
      'Welcome aboard! We are thrilled to have you on the ReachInbox team.',
      '',
      'To get you set up this week:',
      '1. Grab your laptop and VPN access from IT (ticket #4821).',
      '2. Join the #new-channel Slack workspace so you can follow team updates.',
      '3. Book 30 minutes with your onboarding buddy for a dashboard walk-through.',
      '',
      'Your first milestone review is the last Friday of the month. No rush on anything until then — just ask questions early and often.',
      '',
      'Excited to build with you,',
      'The ReachInbox team',
    ].join('\n'),
  },
  {
    toEmail: 'kinjaldutta005@gmail.com',
    subject: 'Your weekly product update — 24 Nov',
    body: [
      'Hi Kinjal,',
      '',
      'Quick roundup of what shipped this week:',
      '',
      '• Email scheduler: rate-limiting and delayed sends are live.',
      '• Slack alerts: hourly-cap notifications now post to your channel automatically.',
      '• Search: falls back to PostgreSQL when the Elasticsearch cluster is down.',
      '',
      'Coming up next: the demo recording and the intern handoff. If anything in the Scheduled or Sent tabs looks off, ping me before Friday.',
      '',
      'Thanks,',
      'Product',
    ].join('\n'),
  },
  {
    toEmail: 'diptimayeepatra07@gmail.com',
    subject: 'Invoice #1042 is ready for your review',
    body: [
      'Hi Dipti,',
      '',
      'Invoice #1042 for the October consulting engagement is ready.',
      '',
      'Amount: $1,250.00',
      'Due: within 15 days of issue date',
      'Reference: RI-2026-1042',
      '',
      'You can view and download the PDF from the payments portal. Let me know if the line items differ from what we agreed — I can re-issue within 48 hours.',
      '',
      'Best,',
      'Billing',
    ].join('\n'),
  },
];

async function main() {
  const user = await p.user.findFirst({ where: { email: SENDER } });
  if (!user) {
    console.error('Google user not found: ' + SENDER);
    process.exit(1);
  }
  const uid = user.id;

  // Remove this user's existing scheduled dummies so we don't duplicate.
  await p.email.deleteMany({ where: { userId: uid, status: 'scheduled' } });

  const sender = await p.sender.upsert({
    where: { userId_email: { userId: uid, email: SENDER } },
    update: {},
    create: { userId: uid, email: SENDER, name: 'Manjima Dutta', hourlyLimit: 5 },
  });

  const start = new Date(Date.now() + 30 * 60 * 1000);
  for (let i = 0; i < DUMMIES.length; i++) {
    const d = DUMMIES[i];
    await p.email.create({
      data: {
        id: randomUUID(),
        userId: uid,
        batchId: null,
        senderId: sender.id,
        toEmail: d.toEmail,
        fromEmail: SENDER,
        subject: d.subject,
        body: d.body,
        sendAt: new Date(start.getTime() + i * 60 * 1000),
        sequence: i + 1,
        status: 'scheduled',
      },
    });
  }

  console.log('Wrote 3 full-body dummies for ' + user.email + ':');
  for (const d of DUMMIES) console.log('  ->', d.toEmail, '|', d.subject, '|', d.body.length, 'chars');
  await p.$disconnect();
}

main().catch((e) => {
  console.error('err:', e.message);
  process.exit(1);
});
