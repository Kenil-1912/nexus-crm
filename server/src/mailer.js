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
  applicationReminder: ({ name, program }) => ({
    template: 'Application reminder',
    subject: `Finish your application for the ${program}`,
    body: `Hi ${name},

You meet the entry requirements for the ${program}, but your application has not been submitted yet.

Log in to complete it:
${appUrl()}/login

RIC Admissions`,
  }),
  detailsReminder: ({ name, program, token }) => ({
    template: 'Details reminder',
    subject: `Continue your enquiry about the ${program}`,
    body: `Hi ${name},

We still need your academic and language details to check the entry requirements for the ${program}.

${token ? `Create your account to continue:\n${appUrl()}/signup/${token}` : `Log in to continue:\n${appUrl()}/login`}

RIC Admissions`,
  }),
  applicationReceived: ({ name, program }) => ({
    template: 'Application received',
    subject: `We have your application for the ${program}`,
    body: `Hi ${name},

Thanks for submitting your application for the ${program}. We will now check your documents, which usually takes up to 3 working days.

You can follow progress in your portal:
${appUrl()}/login

RIC Admissions`,
  }),
  documentRejected: ({ name, documentType, reason }) => ({
    template: 'Document rejected',
    subject: `Please upload your ${documentType} again`,
    body: `Hi ${name},

We could not accept your ${documentType}.

Reason: ${reason}

Log in to upload a new copy:
${appUrl()}/login

RIC Admissions`,
  }),
  documentReminder: ({ name, documentType }) => ({
    template: 'Document reminder',
    subject: `We are still waiting for your ${documentType}`,
    body: `Hi ${name},

Your application is on hold until you upload a new copy of your ${documentType}.

${appUrl()}/login

RIC Admissions`,
  }),
  offer: ({ name, program, expires }) => ({
    template: 'Offer',
    subject: `Your offer for the ${program}`,
    body: `Hi ${name},

Congratulations! We are pleased to offer you a place in the ${program}.

Your offer letter is in your portal. Please accept your offer by ${expires}:
${appUrl()}/login

RIC Admissions`,
  }),
  offerReminder: ({ name, program, expires }) => ({
    template: 'Offer reminder',
    subject: `Your offer for the ${program} expires on ${expires}`,
    body: `Hi ${name},

Your offer for the ${program} is waiting for your reply and expires on ${expires}.

${appUrl()}/login

RIC Admissions`,
  }),
  applicationRejected: ({ name, program }) => ({
    template: 'Application outcome',
    subject: `Your application for the ${program}`,
    body: `Hi ${name},

Thank you for applying for the ${program}. After reviewing your application, we are unable to offer you a place at this time.

RIC Admissions`,
  }),
  enrolled: ({ name, program, intake }) => ({
    template: 'Enrolment confirmation',
    subject: `You are enrolled in the ${program}`,
    body: `Hi ${name},

Welcome to RIC! You are now enrolled in the ${program}${intake ? `, ${intake} intake` : ''}.

Your offer letter and enrolment details are in your portal:
${appUrl()}/login

RIC Admissions`,
  }),
  closedNoResponse: ({ name, program }) => ({
    template: 'Closed',
    subject: `We have closed your enquiry about the ${program}`,
    body: `Hi ${name},

We have not heard from you for a while, so we have closed your enquiry about the ${program}. You are welcome to send a new enquiry at any time:
${appUrl()}/

RIC Admissions`,
  }),
  offerLapsed: ({ name, program }) => ({
    template: 'Offer lapsed',
    subject: `Your offer for the ${program} has expired`,
    body: `Hi ${name},

Your offer for the ${program} was not accepted by the deadline and has now expired. Please contact us if you would still like to study with RIC.

RIC Admissions`,
  }),
  taskEscalation: ({ staffName, taskType, prospectName, dueDate, prospectId }) => ({
    template: 'Task escalation',
    subject: `Overdue task: ${taskType} for ${prospectName}`,
    body: `The task "${taskType}" for ${prospectName}, assigned to ${staffName || 'nobody'}, was due on ${dueDate} and is still open.

${appUrl()}/staff/prospects/${prospectId}`,
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
