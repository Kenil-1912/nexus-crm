# Nexus CRM

Student recruitment CRM for RIC, covering the whole journey from enquiry to enrolment:

1. **Enquiry** – public form with validation, duplicate check, automatic staff assignment, and account creation
2. **Brochure email** – sent automatically after the enquiry
3. **Academic and language details** – student portal form with save-as-draft
4. **Eligibility check** – automatic check against the program's criteria; unclear or failed cases go to staff
5. **Application** – enrolment details and document upload; staff verify or reject each document
6. **Offer** – staff accept the application and an offer letter PDF is generated
7. **Enrolment** – the student accepts the offer in the portal

Around that flow:

- **Reminders and automatic closing** – reminders for stalled records, lapsed offers, "no response" closures, and overdue staff tasks escalated to the manager
- **Pipeline report** – how many prospects reach each stage, where they are lost and why
- **History** – every stage change is written to `stage_history` and `audit_log`

## Stack

- `server/` – Node.js, Express, PostgreSQL (`pg`), JWT logins
- `client/` – React (Vite), React Router

## Run it locally

You need Node.js 20+ and PostgreSQL 14+.

```bash
# 1. Database (once)
psql -U postgres -c "CREATE USER nexus WITH PASSWORD 'nexus' CREATEDB;"
psql -U postgres -c "CREATE DATABASE nexus_crm OWNER nexus;"

# 2. API
cd server
cp .env.example .env        # set JWT_SECRET to a long random string
npm install
npm run db:reset            # creates tables and demo data (wipes existing data)
npm run dev                 # http://localhost:4000

# 3. Front end (second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173
```

## Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Recruiter | sarah@ric.test | Password123! |
| Recruiter | michael@ric.test | Password123! |
| Manager (read-only) | manager@ric.test | Password123! |

These are demo accounts created by `npm run db:reset`. Change them before any real use.

## Trying the flow

1. Open http://localhost:5173, fill in the enquiry form and choose a password. This creates the student account and opens the portal.
2. Submit the academic and language form. A strong one moves to **Qualified** automatically. A borderline or failing one creates a task for the assigned recruiter, who approves or rejects it from the prospect page.
3. As the student, fill in the application and upload the three documents (any PDF, JPG or PNG), then submit.
4. Log in as a recruiter at `/staff`, open the prospect, verify each document, then choose **Accept and issue offer**.
5. Back in the student portal, download the offer letter and choose **Accept offer**.
6. Log in as the manager to see **Reports** and to run the reminder checks on demand.

A task appears only on the dashboard of the recruiter the prospect is assigned to, but any recruiter can open any prospect.

Emails (brochure, qualified, not eligible) are recorded on the staff **Email log** page and not sent until you set `SMTP_HOST` in `server/.env`.

Because the account is created without an emailed link, the email address is not verified. Add an email confirmation step once a mail server is set up.

## Tests

```bash
cd server
npm test        # resets the database, then runs the end-to-end API tests
```

## Where things are

| File | What it does |
| --- | --- |
| `server/db/schema.sql` | All tables and constraints |
| `server/src/pipeline.js` | Allowed stage transitions; the only place a stage changes |
| `server/src/criteria.js` | Eligibility rules (qualification levels, test score ranges and margins) |
| `server/src/validate.js` | Field validation rules |
| `server/src/mailer.js` | Email templates and sending |
| `server/src/application.js` | Document checklist, file checks, download |
| `server/src/offerLetter.js` | Offer letter PDF |
| `server/src/jobs.js` | Reminder, auto-close and escalation rules, with their day limits in `RULES` |
| `server/src/routes/` | `public.js` (enquiry, sign-up, login), `student.js`, `studentApplication.js`, `staff.js`, `staffApplication.js` (includes reports) |
| `client/src/pages/` | One file per screen |

## Good to know

- Uploaded files and offer letters are stored in the database (`document.content`), up to 10 MB each. For heavy use, move them to file or object storage.
- The reminder checks run 30 seconds after the API starts and every 6 hours. `npm run jobs` in `server/` runs them once.
- Timings: details reminder after 3 days and close after 14; application reminder after 7 days and close after 30; rejected-document reminder after 5 days and close after 21; offers last 14 days with a reminder 7 days before; tasks escalate 2 working days after their due date.

## Not built yet

- Email verification, login rate limiting and password reset
- Staff screens to manage programs, intakes, entry criteria, document checklists and staff accounts (these come from `server/db/reset.js`)
- CSV export of reports
