# ISO/IEC 27001:2022 — technical controls in the HRMS

## What this document is, and is not

ISO/IEC 27001 certifies a **management system**, not software. Certification
requires a scope statement, a risk assessment and treatment plan, a Statement of
Applicability, an owner for every control, competence and awareness records,
internal audit, management review, and evidence that all of it runs on a cycle.
None of that is code and none of it is in this repository.

What follows is the subset of Annex A that a database and an API can be
responsible for: what was assessed, what was actually found, and what was
changed. Everything marked ✅ was verified against the running system, not
inferred from reading the source.

Anything marked ⚠️ is a real gap that remains, stated so it can be risk-assessed
rather than discovered later.

---

## A.5.15 Access control · A.8.3 Information access restriction

**Finding — resolved.** Every table has row level security enabled (verified:
no table in `public` has `relrowsecurity = false`). But the generic `/query`
endpoint allowed a read of any collection that was in `READABLE` *or*
`WRITABLE`, and both `users` and `employees` are writable. The effect:

- any employee could read every colleague's **`password_hash`** — HR's and the
  founder's included, at bcrypt cost 6, to crack at leisure offline
- and every colleague's `pan_number`, `aadhaar_number`, `bank_account_number`,
  `bank_ifsc`, `dob` and `address`

RLS was not at fault. It correctly scoped the *rows*; the exposure was in the
*columns*, which row level security cannot express.

**Change.** `WRITE_ONLY` in `server/src/query.ts` — both tables remain writable
and are no longer readable through the generic endpoint. Each already had a
curated read path (`employee_directory`, `/auth/me`, `get_employee_detail`), and
the frontend never selected from either, so nothing lost a capability.

✅ Verified: employee reads of `users` and `employees` are refused; the
directory, profile RPC and `/auth/me` all still work.

## A.8.11 Data masking

**Finding — resolved.** `employee_directory` returned `phone`, `address`, `dob`
and `gender` for every colleague. Nothing had leaked only because no record had
those fields filled in; the first time HR completed one it would have been
readable by all staff.

**Change.** Migration `0016` masks those four columns to null unless the row is
the caller's own or the caller is HR. Name, employee code, work email,
department, designation and reporting manager stay visible — a directory.

✅ Verified inside a rolled-back transaction: a colleague sees nulls, the person
themselves and HR see the values.

## A.8.24 Use of cryptography

**Finding — resolved.** All nine passwords were stored at **bcrypt cost 6** —
64 rounds, against current guidance of 4,096 or more. Not an accident of
history: `set_own_password`, `set_employee_password` and
`create_employee_with_login` all called `gen_salt('bf')` with no cost, and this
server's default is 6, so every *new* password was created just as weak.

**Change.** Migration `0018` sets cost 12 explicitly in all three functions, and
adds `upgrade_password_hash`, which the API calls after a successful sign-in —
the only moment the plaintext exists to rehash. It verifies the password before
rewriting the hash, so it cannot be used to overwrite the credential of an
account whose password is unknown.

✅ Verified: after one sign-in, that account moved to `$2a$12$` and the change
was logged as `password.rehashed {from_cost: 6, to_cost: 12}`. The remaining
eight upgrade silently as each person next signs in.

### A.5.17 Authentication information — the seeded passwords

**Finding — resolved.** The seeded passwords are published in this repository
(`seed.mjs`, `reset-passwords.sql`). Rehashing makes a password expensive to
crack; it does not make a published one secret.

**Change.** All nine were replaced with 16-character random passwords, hashed at
cost 12, in a single transaction — all nine or none, so a failure partway could
not have locked anyone out of a subset of accounts.

✅ Verified: all nine new passwords sign in; the published ones (`Kalyani@123`,
`Prozonic@123`) are now refused with 400. Every account is `$2a$12$`. The
rotation is in the audit trail as `password.rotated`.

The generated alphabet excludes `0/O` and `1/l/I` — these get read aloud and
typed on phone keyboards, and the ambiguity causes more lockouts than those
characters add entropy. Generation uses rejection sampling rather than modulo,
which would have made early letters of the alphabet slightly likelier.

⚠️ `password.rotated` records 8 of the 9. The super admin belongs to no company
and `audit_logs.company_id` is NOT NULL, so that entry was skipped — the same
per-tenant limitation noted under A.8.15. The password itself did change.

### A.5.17 — the password policy reached only one door

**Finding — resolved.** A policy existed (8 characters, upper, lower, number or
symbol) in `validatePasswordStrength`, called from the Express handler for
`/auth/password`. Every other way of setting a password went straight to the
database, which asked only for 8 characters.

Found by setting `password` — 8 characters, no capital, no digit, and the most
common password in every breach corpus — by each available route:

| Route | Before | After |
|---|---|---|
| `set_employee_password` (HR resets anyone) | **accepted** | refused |
| `change_own_password` | **accepted** | refused |
| `create_employee_with_login` (every new hire) | **accepted** | refused |

An app-layer rule is a rule for one endpoint. This codebase's whole approach is
that rules belong in the database — it is why RLS decides who sees what — and a
password policy is no different.

**Change.** Migration `0025` adds `assert_password_policy`, called by all three.
The rules match `validatePasswordStrength` exactly: two layers disagreeing about
what is acceptable is worse than one, because the error a user sees would then
depend on which door they came through. A short denylist catches the passwords
that satisfy every composition rule and are still guessed first — `Password1` is
the standard illustration of why composition alone is not enough.

**A second defect, found while fixing the first.** `create_employee_with_login`
still hashed with `gen_salt('bf')` and no cost, so every new hire was created at
cost 6 while migration `0018` was raising everyone else to 12. That migration
updated two of the three functions and missed this one — the weakness was being
reintroduced with each person hired. Now cost 12.

✅ Verified against ten cases — seven refused (no capital, no digit, 7
characters, no lowercase, no uppercase, no symbol, on the denylist) and three
accepted (a generated password, a passphrase, a long memorable one). A policy
that blocks legitimate passwords fails differently but just as badly: it pushes
people to write them down. Login and the API path both still behave.

## A.8.5 Secure authentication

**Finding — resolved.** Sign-in had no throttling of any kind: an unlimited
password oracle.

**Change.** `server/src/security.ts` — five failures in fifteen minutes locks
the account for fifteen. Keyed on the **email, not the IP**: the attack is
against one account and an attacker rotates IPs freely, while keying on IP would
let one colleague's typo lock out an office behind a single NAT. The trade is
that someone who knows an address can lock its owner out for fifteen minutes —
a nuisance, against an unthrottled oracle, which is a breach.

✅ Verified: five failures returned 400, the sixth 429, and **a valid password
was also refused while locked**. An untouched account signed in normally
throughout.

⚠️ In memory. A restart forgives every attempt, and two instances count
separately. Correct for one instance; move to Redis or a table before scaling.

## A.8.15 Logging · A.8.16 Monitoring

**Finding — resolved.** `audit_logs` existed, was append-only (`update` and
`delete` revoked), and readable only by HR — a sound design that **nothing had
ever written a row to**. Zero rows. An empty audit table provides no
accountability and no detection while appearing to.

**Change.** `log_security_event` (SECURITY DEFINER, because the most important
event — a failed sign-in — has no session to attribute it to and cannot satisfy
the insert policy). Wired into login success, failure and lockout, password
change, admin password reset, and rehash.

✅ Verified: `login.succeeded`, `login.failed` and `password.rehashed` all
appear, with IP and result recorded in their own columns. **No password, and no
password length, is ever written** — an audit log should not become the thing
worth stealing.

> Worth recording as a lesson: the first version of this function omitted the
> NOT NULL `company_id`, so every insert failed — and the `exception when others
> then null` handler that keeps logging from breaking sign-in swallowed the
> error silently. It looked like it worked. Anything depending on these events
> must verify the rows *arrive*, not that the call returned.

⚠️ An attempt against an address belonging to no company cannot be filed: the
table is per-tenant and `company_id` is NOT NULL. Attacks on real accounts are
recorded; probes for invented addresses are dropped.

### The log was not actually tamper-proof

**Finding — resolved.** An earlier version of this document called `audit_logs`
append-only, on the strength of the schema's `revoke update, delete ... from
authenticated`. That revoke is real and still in force. It was also irrelevant,
because `finalize-neon.ts` follows it with

```
grant select, insert, update, delete on all tables in schema public to hrms_app
```

and `hrms_app` is the role the API connects as. **The application could rewrite
or delete any audit row, including the record of what it had just done.** Found
by attempting the UPDATE rather than by reading the schema, which is the only
way it would ever have shown up — the schema reads correctly.

A.8.15 asks that logs be protected against tampering. An audit trail its own
subject can edit is not evidence of anything.

**Change.** Migration `0024` revokes UPDATE and DELETE from `hrms_app`, and
`finalize-neon.ts` now performs the same narrowing immediately after its blanket
grant — along with the `users.password_hash` revoke from `0017`, which that same
grant had been silently undoing. Fixing the script rather than only the database
is the point: otherwise the next person to run it reopens both holes and nothing
says so.

✅ Verified: `update refused — permission denied for table audit_logs`, while
INSERT and SELECT still work, logging is unaffected, and all 95 rows survived.

| grantee | privileges on audit_logs |
|---|---|
| `hrms_app` | INSERT, SELECT |
| `authenticated` | INSERT, SELECT |
| `neondb_owner` | full (owner; schema work only) |

### Identifiers: the email domain

Six sign-in addresses were on `whhohhpath.com` (single o) while the company,
the letterhead and one employee's own address use `whhoohh`. Migration `0018`
had corrected the company name and even stated the domain was
`whhoohhpath.com`, without touching the addresses. Corrected in `0023`, and in
the eight seed and setup files that would otherwise reintroduce it.

All 88 text columns in the database were scanned rather than guessed at. The
domain appeared in exactly two places and only one was changed: `users.email`.
**`audit_logs.meta` was left alone** — those 60 rows record the addresses as
they were at the time, and correcting history to make it tidy is precisely what
the control above exists to prevent.

## A.5.16 Identity management · A.8.2 Privileged access

✅ Assessed: 9 accounts, all active, all have signed in — no dormant identities.
⚠️ **4 of 9 hold privileged roles** (super_admin, founder, company_admin,
hr_admin). Defensible at this size, but it is the ratio to watch as staff grow,
and it should have a named owner and a periodic review.

## A.5.18 Access rights — session revocation

**Addressed by migrations 0019/0020 (written in parallel work) — and, more to
the point, now applied and tested.**

The code was already there: `issueToken` stamps a `version`, `/auth/logout`
revokes, `/auth/password` calls `change_own_password`, and `auth.ts` checks
`token_version` and `password_changed_at` on every request. But the migrations
that add those columns had **never been run**, and `auth.ts` reads them with
optional chaining — so every check silently evaluated to "fine" and the control
did nothing at all. Written on both sides, inert in the middle.

✅ Verified end to end after applying them:

| Test | Result |
|---|---|
| Token works before logout | 200 |
| Same token after `/auth/logout` | **401** |
| Two devices signed in, one changes the password | **the other is 401** |
| Old password after change | 400 |
| New password | 200 |
| Password change with the **wrong** current password | refused; the attempted new password does not work |

That last row is the C2 finding 0019 was written for: the endpoint used to accept
a new password without proving the current one.

⚠️ Two small things this testing turned up, neither a security defect:

- A rejected password change answers **401 "Not authenticated"** when the real
  reason is a wrong current password. A client seeing 401 may sign the user out
  for what was a simple typo.
- 0019 says it logs "success and failure", but only the success appears in
  `audit_logs`. A failed password change is exactly the event worth having.

**A correction to an earlier version of this document:** it claimed a
deactivated employee keeps access until their token expires. That was wrong —
`resolve_session` filters on `u.is_active`, so deactivation takes effect on the
very next request.

## A.8.13 Backup · A.5.30 ICT readiness

**Addressed — and tested, which is the part that makes it a control.**

`neon/backup.mjs` dumps the database and then proves the dump restores: it
creates a throwaway database, restores into it, compares row counts table by
table, and drops it again. A backup nobody has restored is an assumption, and
the moment you discover it was wrong is the moment you needed it.

✅ Verified end to end:

| | source | restored |
|---|---|---|
| users / employees | 9 / 8 | 9 / 8 |
| attendance_records | 110 | 110 |
| leave_requests / tasks / projects | 6 / 12 / 1 | 6 / 12 / 1 |
| payslips / audit_logs | 56 / 22 | 56 / 22 |
| tables · RLS enabled · policies | 38 · 38 · 66 | 38 · 38 · 66 |
| functions · views | 95 · 19 | 95 · 19 |
| grants to `hrms_app` | 227 | 227 |

**The measurement caught a real defect.** The first version used
`--no-privileges`, and the restored copy came back with every table, every RLS
flag, all 66 policies, 95 functions and 19 views — and **0 of 227 grants**.
Every policy present and `hrms_app` unable to read a single row: a restore that
looks complete and leaves the application unable to start. Nothing but comparing
the two databases would have shown it, least of all a successful-looking dump.

The dump runs as the **owner**, not `hrms_app`. A dump taken as the application
role is filtered by row level security and would silently be partial — it would
look like a successful backup of a nearly empty database.

⚠️ Remaining: this is a manual run. It needs a schedule, and the dumps need to
live somewhere other than the machine that made them — `backup/` is gitignored
(it holds every employee record) but a copy on the same laptop is not an
off-site backup. Neon's own point-in-time recovery has still not been verified;
it is a separate control from this one and worth confirming on your plan.

---

## Remaining gaps, in the order they are worth fixing

2. **Schedule the backup and move copies off this machine.** The restore is
   now proven (see A.8.13); what remains is that it runs on its own and that a
   dump does not live only on the laptop that produced it.
3. ~~Session revocation~~ — **done, see A.5.18 below.**
4. ~~Password policy~~ — **done, see A.5.17 below.**
5. **Move throttling out of memory** before running more than one instance.
6. **Transport.** Traffic currently goes through a developer tunnel; a
   production deployment needs its own TLS and a stable origin — which WebAuthn
   also requires, since a credential is bound to the origin it was enrolled on.
