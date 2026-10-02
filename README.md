# SCP Study Announcements

Dedicated passwordless messaging and polling app for SCP Study.

## What it does

- Admin-created email accounts with passwordless six-digit email verification codes.
- Explicit permissions for Chabura announcements, Chabura polls, and all-student broadcasts.
- Chabura assignments from the canonical Summer 2026 SCP Study directory (243 entries).
- Rich-text announcements and polls.
- Gentle broadcast confirmation with known-student and push-enabled counts.
- Anonymous one-vote poll invitations.
- Reuses the existing Analytics D1 database and Web Push subscriptions.

## First-time setup

The app deploys without email credentials, but sign-in email cannot work until email delivery is configured.

Set the Worker variable:

- `BOOTSTRAP_ADMIN_EMAIL` — the first administrator's email.
- `EMAIL_FROM` — a verified sender such as `SCP Study <announcements@example.com>`.

Then configure **one** email provider:

### Option A — Cloudflare Email Service

Onboard a domain in Cloudflare Email Service and add a Worker send-email binding named `EMAIL`.

### Option B — Resend

Add the Worker secret `RESEND_API_KEY` for a verified Resend sender domain.

After the first admin signs in, all other accounts are created from the Admin tab.

## Build

```sh
npm install
npm run build
```

Cloudflare deploys `main` automatically.
