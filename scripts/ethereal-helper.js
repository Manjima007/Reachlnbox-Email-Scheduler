#!/usr/bin/env node
/**
 * Prints a fresh Ethereal SMTP test account.
 * Usage:  node scripts/ethereal-helper.js
 *
 * Save the output to backend/.env as SMTP_USER / SMTP_PASS to keep the
 * same account across restarts. Without this, the worker auto-creates
 * a new account on every process start.
 */
const nodemailer = require('nodemailer');

async function main() {
  const account = await nodemailer.createTestAccount();
  console.log(`# Paste into backend/.env`);
  console.log(`SMTP_USER=${account.user}`);
  console.log(`SMTP_PASS=${account.pass}`);
  console.log(`SMTP_HOST=smtp.ethereal.email`);
  console.log(`SMTP_PORT=587`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
