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
