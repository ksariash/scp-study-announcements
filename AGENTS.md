# SCP Study Announcements — LLM operating guide

Read this file before changing the repository.

## Purpose

This Worker is the authenticated composition/admin surface for SCP Study announcements and polls. It shares the existing `scp-study-analytics-db` D1 database so it can use the same anonymous learner profiles, notification inbox records, Web Push subscriptions, and VAPID configuration.

The current Zman is `2026-summer`.

## Deployment authority

A request to implement a change normally means: inspect current `main` → implement → run `npm run build` → commit atomically to `main` → let Cloudflare deploy → inspect the Cloudflare Workers Builds result.

Do not claim a production release from a Git commit alone.

## Authentication

There are no passwords. Accounts are admin-created and users sign in with a short-lived email verification code.

Never:
- add password storage;
- store raw OTP codes;
- store raw session tokens;
- allow self-registration;
- disclose whether an arbitrary email is an account in the code-request response.

The first administrator is bootstrapped only from the Cloudflare variable `BOOTSTRAP_ADMIN_EMAIL`.

Email delivery supports:
1. a Cloudflare Email Service binding named `EMAIL`, plus `EMAIL_FROM`; or
2. a `RESEND_API_KEY` secret plus `EMAIL_FROM`.

Do not commit email API keys or account email addresses.

## Permissions

Permissions are explicit:
- `allow_chabura_announcements`
- `allow_chabura_polls`
- `allow_broadcasts`

A non-admin may target only chaburas assigned to that account. `allow_broadcasts` permits all-student sends. Administrators can manage accounts and all audiences.

Broadcast UI must show a gentle all-students warning and the push-enabled count before final confirmation.

## Chabura directory

`src/chaburas.js` is a synchronized copy of the canonical current-Zman chabura list from:
`scp-study/public-src/cohorts/2026-summer/chaburos.js`.

When the Study chabura source changes, synchronize this file in the same cross-repo task. The build checks that the directory is plausibly complete and has no duplicate region/name pairs.

## Notifications and polls

The durable inbox is `app_notifications` in the shared D1 database. Push is a delivery channel, not the source of truth.

Rich message HTML must be server-sanitized to the small allowlist in `sanitizeRichHtml()`. Never trust contenteditable HTML from the browser.

Chabura messages are materialized as per-installation inbox records so only that chabura sees them. Broadcast announcements may use one global inbox record. Polls always use per-installation invitation tokens so each recipient has one anonymous vote token.

Do not expose anonymous installation IDs in admin UI or public poll URLs. Poll URLs use random invite tokens.

## Recipient counts

"Students" means known anonymous installations, not verified human identities. "Push enabled" means distinct anonymous installations with an active stored PushSubscription. Keep those labels accurate.

## UI

Prefer concise interface structure over explanatory prose. Composition uses a small WYSIWYG toolbar; keep the server sanitizer authoritative.

The Admin panel must make it easy to map account email addresses to the existing chabura/rabbi directory and to edit the three permission flags.

## Cross-repo contract

Changes to notification storage or rendering may require coordinated releases in:
- `scp-study-announcements`
- `scp-study-analytics`
- `scp-study`

Deploy backward-compatible storage/API changes before a client starts depending on them.


## Cloudflare variable persistence and diagnostics

`keep_vars` must remain enabled. Operators configure `BOOTSTRAP_ADMIN_EMAIL` and `EMAIL_FROM` in the Cloudflare dashboard, so Git/Wrangler deploys must not erase dashboard variables.

`/api/meta` may expose only non-sensitive configuration booleans/provider names. Never expose secret values or the bootstrap email address.

When a provider call fails, log the provider HTTP status and sanitized response message. Do not log API keys, OTP codes, session tokens, or recipient addresses.


## Feedback-request messages and media

A `feedback_request` is a typed announcement. It uses the sender's Chabura-announcement permission (or broadcast permission for all-student sends). Each recipient gets a random invitation token and a targeted inbox row.

Student replies are anonymous to the sender. Invitation URLs must never contain installation IDs.

Media attachments are stored in the existing Cloudflare R2 bucket through the `MEDIA` binding under `feedback-media/<zman>/...`. Accepted files are images, audio, and video only, at most 3 files, 10 MB each, 20 MB total. Media is not publicly bucket-addressable; the admin/sender downloads through an authenticated Worker route.

The Sent tab's "received" count is the intended known-installation audience saved at send time. "Read" is the number of distinct installations with server-side `notification_state.read_at` for inbox rows associated with that message. Do not describe push delivery as read receipt.


## Sent-history visibility

The Sent panel is permission-scoped. Regular instructors see messages they created. Administrators see the complete message history across all instructors, without an arbitrary recent-item limit. Admin history must identify the sending account so cross-instructor activity is auditable.

## Instructor media

Instructor messages may include up to three image, audio, or video attachments, using the same 10 MB-per-file and 20 MB-total limits as student feedback. Store bytes in R2 and metadata separately in D1.

Message attachments use unguessable capability URLs. Store only a hash of the capability token in D1, and route media through the Worker so possession of the message link is required to read it. Never expose raw R2 object keys as public URLs.

When adding media support to an endpoint, preserve JSON compatibility for older clients and accept multipart requests from the upgraded client.

## Feedback contact details

Feedback may optionally include name, email, and phone. These fields are never required to submit feedback. Validate a supplied email but permit all contact fields to be blank.

When showing contact details to an authorized instructor, expose direct actions for the channels the student supplied: email via `mailto:`, calling via `tel:`, texting via `sms:`, and WhatsApp via `https://wa.me/` after stripping non-digits. Do not invent missing contact information or infer a country code.

## Public capability routes

Public poll, feedback, and message-media capability URLs must be routed through the Worker before the authenticated application gate. Their tokens are bearer capabilities and must be validated server-side. Static asset routing must never swallow `/feedback/*` or `/message-media/*`.

## Cross-app navigation

Announcements should provide clear links to the Study and Analytics Dashboard applications. Keep external SCP-app URLs centralized or visibly identifiable so deployment-domain changes are easy to update.
