# Architecture

## Shared data

The Announcements Worker binds to the same D1 database as SCP Study Analytics.

It reads:
- `learner_profiles` for Zman/chabura membership;
- `events` as a fallback source of known anonymous installations;
- `push_subscriptions` for push delivery and counts;
- `push_config` for the VAPID key pair.

It writes:
- `app_notifications` for the Study inbox;
- `announcement_*` tables for users, sessions, sends, polls, and votes.

## Authentication flow

1. An administrator creates an account.
2. The user enters the authorized email.
3. The server creates a six-digit code, stores only a keyed hash, and emails the code.
4. A valid code creates a random session token; only its SHA-256 hash is stored in D1.
5. The browser receives an HttpOnly, Secure, SameSite=Lax cookie.

OTP codes expire after ten minutes. Sessions expire after thirty days.

## Audience model

A sender can have one or more assigned chaburas.

For a Chabura audience, recipients are the anonymous installations whose current-Zman profile/event is tagged with that chabura. The message is written as one inbox notification per installation.

For a broadcast announcement, one global inbox record is enough because Study already filters global notifications into every active-Zman inbox. Push is sent to all stored subscriptions.

Polls always create per-installation inbox rows because each row contains a distinct random voting token.

## Rich text

The WYSIWYG editor produces a deliberately small HTML subset. The Worker re-parses tokens and emits only normalized:
`p br strong b em i u ul ol li a`.

All attributes are discarded except safe HTTP(S) anchor URLs. Push notifications use the derived plain-text version.

## Poll privacy

Poll invitation URLs carry random tokens, not installation IDs. D1 stores only a SHA-256 hash of each invite token and a SHA-256 hash of the corresponding anonymous installation ID. Votes are keyed to the invite hash.

## Email provider

The code works with either a Cloudflare Email Service binding called `EMAIL` or the Resend HTTP API. Provider credentials and the sender identity are deployment configuration, not repository content.
