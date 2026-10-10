// Outgoing email. With no SMTP_HOST configured, emails are not sent: they are
// stored in email_log with status "Logged" so the flow can be demonstrated.
import nodemailer from 'nodemailer';
import { query } from './db.js';

export const smtpConfigured = () => Boolean(process.env.SMTP_HOST);
const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

let transport;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

export const templates = {
  brochureSignup: ({ name, program, brochureUrl, token }) => ({
    template: 'Brochure',
    subject: `Your ${program} brochure`,
    body: `Hi ${name},

Thanks for your enquiry about the ${program}.

Course brochure: ${brochureUrl || 'available on request'}

If you would like to go further, create your account and tell us about your academic background:
${appUrl()}/signup/${token}

This link works once and expires in 14 days.

RIC Admissions`,
  }),
  brochureLogin: ({ name, program, brochureUrl }) => ({
    template: 'Brochure',
    subject: `Your ${program} brochure`,
    body: `Hi ${name},

Thanks for your enquiry about the ${program}.

Course brochure: ${brochureUrl || 'available on request'}

You already have an account. Log in to continue:
${appUrl()}/login

RIC Admissions`,
  }),
  qualified: ({ name, program }) => ({
    template: 'Qualified',
    subject: `You meet the entry requirements for the ${program}`,
    body: `Hi ${name},

Good news: you meet the entry requirements for the ${program}.

Log in to start your application:
${appUrl()}/login

RIC Admissions`,
  }),
  underReview: ({ name, program }) => ({
    template: 'Under review',
    subject: `We are reviewing your details for the ${program}`,
    body: `Hi ${name},

Thanks for sending your academic and language details. A member of our team is reviewing them and will be in touch within 2 working days.

RIC Admissions`,
  }),
  notEligible: ({ name, program }) => ({
    template: 'Not eligible',
    subject: `Your enquiry about the ${program}`,
    body: `Hi ${name},

Thank you for your interest in the ${program}. After reviewing your details, we are unable to offer you a place in this program at this time.

You are welcome to enquire about our other programs:
${appUrl()}/

RIC Admissions`,
  }),
};

/**
 * Send (or log) one email. Never throws: a failed email must not undo the
 * action that triggered it. Returns the final status.
 */
export async function sendEmail({ prospectId, to, template, subject, body }) {
  let status = 'Logged';
  if (smtpConfigured()) {
    status = 'Failed';
    for (let attempt = 1; attempt <= 3 && status === 'Failed'; attempt += 1) {
      try {
        await getTransport().sendMail({ from: process.env.MAIL_FROM, to, subject, text: body });
        status = 'Sent';
      } catch (err) {
        console.error(`Email "${template}" to prospect ${prospectId} failed (attempt ${attempt}): ${err.message}`);
      }
    }
  }
  try {
    await query(
      `INSERT INTO email_log (prospect_id, template, to_email, subject, body, status) VALUES ($1, $2, $3, $4, $5, $6)`,
      [prospectId, template, to, subject, body, status],
    );
  } catch (err) {
    console.error(`Could not write email_log: ${err.message}`);
  }
  return status;
}
