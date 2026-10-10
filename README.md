# Nexus CRM

Student recruitment CRM for RIC. This first build covers steps 1 to 4 of the flow:

1. **Enquiry** – public form, server-side validation, duplicate check, automatic staff assignment
2. **Brochure email** – automatic email with the brochure and a single-use sign-up link
3. **Sign-up and details** – student account, academic and language form with save-as-draft
4. **Eligibility check** – automatic check against the program's criteria; unclear or failed cases go to staff to approve or reject

Every stage change is written to `stage_history` and `audit_log`.

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
2. Submit the academic and language form.
3. A strong application moves to **Qualified** automatically. A borderline or failing one creates a task for the assigned recruiter, who approves or rejects it from the prospect page.

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
| `server/src/routes/` | `public.js` (enquiry, sign-up, login), `student.js`, `staff.js` |
| `client/src/pages/` | One file per screen |

## Not built yet

- Steps 5 to 7: application form, document upload and verification, offer letter, enrolment
- Reminder and auto-close jobs (no sign-up after 3 days, and so on)
- Pipeline leak reports (the data is already recorded in `stage_history`)
- Email verification, login rate limiting and password reset
