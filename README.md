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


## Release 2 — email setup diagnostics

- Sets `keep_vars: true` so dashboard-created plaintext variables survive future Git/Wrangler deployments.
- `/api/meta` now reports non-sensitive booleans for bootstrap admin, `EMAIL_FROM`, Resend, and Cloudflare Email binding configuration.
- Login displays missing email configuration instead of silently suggesting a code was sent.
- Resend API failures now surface the provider HTTP status/message and are logged in Worker logs.

For a Resend test sender, `EMAIL_FROM` may be set to `SCP Study <onboarding@resend.dev>`. The Worker URL/domain is unrelated to the email sender domain.


## Release 3

- Fixes Add Poll Option so a new option is always blank and not browser-autofilled from the previous option.
- Sent messages show received and read counts from inbox state.
- Adds Feedback request messages with rich-text student replies that are anonymous by default, with optional contact details when a student wants a direct response.
- Adds up to three image/audio/video attachments per feedback reply, stored privately in Cloudflare R2.
- Senders/admins can review feedback responses and attachments from Sent.


## Release 4

- Administrators can review the full sent-message history across instructors.
- Instructors can attach up to three images, audio files, or videos to announcements, polls, and feedback requests.
- Feedback forms now offer optional name, email, and phone fields.
- Feedback responses provide one-click email, call, text, and WhatsApp actions when corresponding contact information was supplied.
- Added direct navigation to SCP Study and the Analytics Dashboard.
- Public feedback and protected message-media capability URLs are explicitly routed through the Worker.
