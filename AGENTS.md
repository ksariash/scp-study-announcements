# SCP Study Announcements — LLM operating guide

Read this file before changing the repository.

## Purpose

This Worker is the authenticated composition/admin surface for SCP Study announcements and polls. It shares the existing `scp-study-analytics-db` D1 database so it can use the same anonymous learner profiles, notification inbox records, Web Push subscriptions, and VAPID configuration.

The current Zman is `2026-summer`.

### Shared D1 initialization invariant

Do not assume the Analytics Worker, a cron task, an admin route, or another Announcements request has already initialized shared D1 schema. Every request path that reads or writes a runtime-managed table/column must invoke its idempotent schema ensure/migration before the first database operation that depends on it. Keep any duplicated/shared schema expectations compatible with Analytics.

For every D1-affecting change, validate the affected route as the **first request** against a clean local database, and account for a partially migrated production database where legacy tables exist but a newly required table/column does not. A warmed-database happy path is not sufficient validation.

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

Chabura messages are materialized as per-anonymous-learner inbox records so only that chabura sees them. The legacy database/API field remains `installation_id`; sync-enabled devices deliberately share that value. Broadcast announcements may use one global inbox record. Polls use the same anonymous learner identity so linked devices do not create extra votes.

Do not expose anonymous installation IDs in admin UI or public poll URLs. Poll URLs use random invite tokens.

## Recipient counts

"Students" means known anonymous learner IDs, not verified human identities. For unsynced users this is still effectively one installation; linked devices share one learner ID. "Push enabled" means anonymous learners with at least one active stored PushSubscription. Keep those labels accurate and do not count multiple linked device endpoints as multiple students.

## UI

Prefer concise interface structure over explanatory prose. Composition uses a small WYSIWYG toolbar; keep the server sanitizer authoritative.

The Admin panel must make it easy to map account email addresses to the existing chabura/rabbi directory and to edit the three permission flags.

## Cross-repo contract

Changes to notification storage or rendering may require coordinated releases in:
- `scp-study-announcements`
- `scp-study-analytics`
- `scp-study`

Deploy backward-compatible storage/API changes before a client starts depending on them.

## Planned one-time wider-production cutover

The owner plans one exceptional clean cutover for a rewritten test when the new custom domains are live. This is a runbook, **not authorization to erase production data**. Do not reset D1 until the owner explicitly gives a same-turn go-ahead after confirming the new content and domains are ready. After this release, normal migrations must preserve production data; never infer permission for another reset from this exception.

Target public origins are `https://scp-study.com`, `https://dashboard.scp-study.com`, and `https://announcements.scp-study.com`. Update `STUDY_APP_URL`, the Dashboard navigation target, and any origin/VAPID configuration as part of the coordinated cutover. A custom domain is a new browser origin, so sessions, local storage, Push subscriptions, and installed Home Screen state do not migrate automatically; expect instructors to sign in on the new Announcements origin and users to re-enable Push as needed.

The rewritten Study content must use a **new permanent Zman ID** rather than reusing `2026-summer`. The owner must approve the final ID. Synchronize `src/chaburas.js` from that Zman's canonical Study chabura list and change Announcements' current-Zman configuration only as part of the coordinated release, after Analytics is ready for the new Zman.

Announcements shares `scp-study-analytics-db` with Analytics. Immediately before any authorized clean reset, verify the exact D1 target, export a recoverable backup, and record known-good Git/Cloudflare versions/configuration. A full D1 reset deletes Announcements accounts, sessions, sent-message/poll records, push/VAPID rows, notification/sync state, analytics/feedback, and R2 media metadata. It does **not** delete the R2 objects themselves; do not wipe R2 unless separately and explicitly authorized. Losing D1 media metadata may orphan those R2 objects.

After an explicitly authorized reset, exercise the normal idempotent schema creation as a fresh-database first request, then re-bootstrap the first admin using the documented `BOOTSTRAP_ADMIN_EMAIL` flow; do not persist the bootstrap email in source. Verify sign-in/OTP, account administration, sending announcements and polls, Study inbox/push delivery, and all custom-domain navigation. Retain the D1 backup until the wider-production release is accepted.


## Cloudflare variable persistence and diagnostics

`keep_vars` must remain enabled. Operators configure `BOOTSTRAP_ADMIN_EMAIL` and `EMAIL_FROM` in the Cloudflare dashboard, so Git/Wrangler deploys must not erase dashboard variables.

`/api/meta` may expose only non-sensitive configuration booleans/provider names. Never expose secret values or the bootstrap email address.

When a provider call fails, log the provider HTTP status and sanitized response message. Do not log API keys, OTP codes, session tokens, or recipient addresses.


## Feedback-request messages and media

A `feedback_request` is a typed announcement. It uses the sender's Chabura-announcement permission (or broadcast permission for all-student sends). Each recipient gets a random invitation token and a targeted inbox row.

Student replies are anonymous by default. A student may optionally supply name, email, and/or phone when they want a direct reply; never infer identity from the invitation token. Invitation URLs must never contain installation IDs.

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

Announcements is part of one instructor workflow with Study and Analytics Dashboard. Keep Study, Dashboard, and Sign out together in the header's top-right utility group, in that order with Sign out rightmost. Use matching compact icon actions with `aria-label` and `title`; keep the same top-right placement on mobile rather than wrapping the app links underneath the title.

Production origins:
- Study: `https://scp-study.ksariash.workers.dev/`
- Dashboard: `https://scp-study-analytics.ksariash.workers.dev/`

The signed-in display name belongs under the Announcements title, not inside the utility group.

## Permission-driven UI refresh

Treat `/api/me` as the current source of truth for permissions. After an administrator saves an account change, refresh current-session permission state and re-render permission-dependent UI immediately:
- Admin-tab visibility and active-tab fallback;
- assigned Chabura audiences;
- message-type/audience availability;
- the signed-in display name;
- currently open Sent/Admin data when its visibility scope depends on permissions.

Do not require a page refresh for these changes. If the current account becomes inactive and the session can no longer load, return to the sign-in flow.

## Shared SCP suite design contract

Study, Analytics Dashboard, and Announcements should read as one product family.

- Use the restrained navy/blue palette, white surfaces, cool-gray borders, modest shadows, and compact rounded controls already established by the suite.
- Prefer familiar icons for compact utility/navigation actions. Icon-only controls require both `aria-label` and `title`.
- Header layout is a flexible title/content region with `min-width:0` plus a non-wrapping utility region with `flex:0 0 auto`. On narrow screens the utility region remains top-right.
- All flex/grid children that can contain dynamic content must be shrink-safe. Use `min-width:0`; form controls use `width:100%`, `max-width:100%`, and `box-sizing:border-box`. Long names, email addresses, and content must wrap or truncate intentionally rather than widening a panel.
- Reuse existing button, card, spacing, radius, and border patterns before adding one-off variants.
- Before release, inspect authenticated desktop and narrow-mobile layouts, long account names, Admin forms, Sent cards, dialogs, and permission transitions—not only JavaScript syntax.
- iOS Home Screen artwork is a separate compatibility surface from the SVG favicon. Keep the unique Announcements SVG favicon and also ship a 180×180 PNG at `/apple-touch-icon.png`; render an explicit `<link rel="apple-touch-icon" sizes="180x180" ...>` in the document head. Version the icon URLs whenever artwork changes so a newly added Home Screen shortcut is not served stale icon metadata.
