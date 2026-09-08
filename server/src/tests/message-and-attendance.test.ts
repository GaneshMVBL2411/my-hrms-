import assert from "node:assert/strict"
import "../env.js"
import pg from "pg"

/**
 * The rules migrations 0030 and 0031 put in the database, checked by trying
 * them rather than by reading the SQL back.
 *
 * Both migrations exist because a policy written for one purpose turned out to
 * govern something else as well, and neither was caught by reading:
 *
 *   0030  messages had UPDATE and DELETE revoked outright, so a typo was
 *         permanent. It now allows an edit and a withdrawal inside fixed
 *         windows, and the whole value of that is what it still refuses —
 *         a hard delete, a re-pointed recipient, an edit after the window,
 *         a participant reading the edit history back.
 *   0031  files was written when it held employee photos uploaded by HR, so
 *         app_is_hr() guarded every write. An employee photographing
 *         themselves at their own check-in was refused, and the punch was
 *         lost with it. The repair is narrow on purpose, and "narrow" is a
 *         claim that has to be tested from the wrong side.
 *
 * Everything runs inside a transaction that is rolled back, as the app role,
 * so the policies under test are the ones actually deciding. Nothing is
 * written to the database and no test data survives the run.
 *
 * A denial arrives one of two ways, and both are checked deliberately:
 * an INSERT that violates a policy raises, while an UPDATE or DELETE whose
 * rows the policy hides simply matches nothing. Asserting only on the
 * exception would call the second case a pass.
 */

const CONN = process.env.DATABASE_URL
const OWNER = process.env.DATABASE_URL_OWNER

async function runTests() {
  console.log("=== RUNNING MESSAGE + ATTENDANCE POLICY TESTS ===\n")

  if (!CONN || !OWNER) {
    console.log("  SKIPPED: DATABASE_URL and DATABASE_URL_OWNER are both required.")
    return
  }

  // The user list is read as the owner: users is behind RLS, and the session
  // context that would open it is the thing being set up.
  const owner = new pg.Pool({ connectionString: OWNER, ssl: { rejectUnauthorized: true }, max: 1 })
  const roleQuery = `
    select u.id, u.company_id, r.name as role
      from public.users u
      join public.roles r on r.id = u.role_id
     where u.company_id is not null`
  const { rows: staff } = await owner.query<{ id: number; company_id: number; role: string }>(
    `${roleQuery} and r.name not in ('founder','company_admin','hr_admin') order by u.id limit 2`
  )
  const { rows: admins } = await owner.query<{ id: number; company_id: number; role: string }>(
    `${roleQuery} and r.name in ('hr_admin','founder') order by u.id limit 1`
  )
  await owner.end()

  if (staff.length < 2 || admins.length < 1) {
    console.log("  SKIPPED: needs two non-HR users and one HR user in the same company.")
    return
  }
  const person = staff[0]!
  const colleague = staff[1]!
  const hr = admins[0]!

  const pool = new pg.Pool({ connectionString: CONN, ssl: { rejectUnauthorized: true }, max: 1 })
  const client = await pool.connect()

  const as = async (userId: number, companyId: number) => {
    await client.query("select set_config('app.user_id', $1, true)", [String(userId)])
    await client.query("select set_config('app.company_id', $1, true)", [String(companyId)])
  }

  let savepoints = 0
  /** Runs a statement and reports whether the database let it through. */
  const attempt = async (sql: string, params: unknown[]) => {
    const name = `probe_${++savepoints}`
    await client.query(`savepoint ${name}`)
    try {
      const result = await client.query(sql, params)
      await client.query(`release savepoint ${name}`)
      return { allowed: true, rowCount: result.rowCount ?? 0, rows: result.rows }
    } catch (error) {
      // A rejected statement poisons the transaction until it is rolled back
      // to a mark, so every probe has to carry one.
      await client.query(`rollback to savepoint ${name}`)
      return { allowed: false, rowCount: 0, rows: [], message: (error as Error).message }
    }
  }
  const refused = async (sql: string, params: unknown[]) => {
    const r = await attempt(sql, params)
    // Either it raised, or it was allowed to run and touched nothing.
    return !r.allowed || r.rowCount === 0
  }

  await client.query("begin")
  try {
    // -------------------------------------------------------------------------
    // TEST 1: 0030 — a sender may correct their own message, briefly
    // -------------------------------------------------------------------------
    console.log("Test 1: Verifying a sender can edit their own message inside the window...")
    await as(person.id, person.company_id)
    const { rows: created } = await client.query<{ id: number }>(
      `insert into public.messages (company_id, recipient_id, body)
       values ($1, $2, $3) returning id`,
      [person.company_id, colleague.id, "original text"]
    )
    const messageId = created[0]!.id
    const edit = await attempt(`update public.messages set body = $1 where id = $2`, [
      "corrected text",
      messageId,
    ])
    assert(edit.allowed && edit.rowCount === 1, "the sender must be able to edit inside the window")
    const { rows: stamped } = await client.query<{ stamped: boolean }>(
      `select edited_at is not null as stamped from public.messages where id = $1`,
      [messageId]
    )
    assert(stamped[0]!.stamped, "the trigger must stamp edited_at on an edit")
    console.log("  PASSED: an edit lands and is marked as one.")

    // -------------------------------------------------------------------------
    // TEST 2: 0030 — the recipient's only power is still marking it read
    // -------------------------------------------------------------------------
    console.log("\nTest 2: Verifying the recipient may mark read and nothing else...")
    await as(colleague.id, colleague.company_id)
    const read = await attempt(`update public.messages set read_at = now() where id = $1`, [messageId])
    assert(read.allowed && read.rowCount === 1, "the recipient must be able to mark a message read")
    assert(
      await refused(`update public.messages set body = 'hijacked' where id = $1`, [messageId]),
      "the recipient MUST NOT be able to edit the message"
    )
    assert(
      await refused(`update public.messages set deleted_at = now() where id = $1`, [messageId]),
      "the recipient MUST NOT be able to withdraw the other party's message"
    )
    console.log("  PASSED: the recipient can mark read, and cannot rewrite or withdraw.")

    // -------------------------------------------------------------------------
    // TEST 3: 0030 — the record itself is still not erasable
    // -------------------------------------------------------------------------
    console.log("\nTest 3: Verifying a message cannot be destroyed or re-addressed...")
    await as(person.id, person.company_id)
    assert(
      await refused(`delete from public.messages where id = $1`, [messageId]),
      "a hard DELETE MUST remain impossible"
    )
    assert(
      await refused(`update public.messages set recipient_id = $1 where id = $2`, [person.id, messageId]),
      "a message MUST NOT be re-pointed at another recipient"
    )
    assert(
      await refused(`update public.messages set edited_at = now() where id = $1`, [messageId]),
      "edited_at MUST NOT be settable without an actual edit"
    )
    assert(
      await refused(`select 1 from public.message_edits limit 1`, []),
      "a participant MUST NOT be able to read the edit history back"
    )
    console.log("  PASSED: no hard delete, no re-addressing, no forged history.")

    // -------------------------------------------------------------------------
    // TEST 4: 0030 — the windows are the database's, not the client's
    // -------------------------------------------------------------------------
    console.log("\nTest 4: Verifying the edit and delete windows are enforced in the database...")
    const aged = async (minutes: number, body: string) => {
      const { rows } = await client.query<{ id: number }>(
        `insert into public.messages (company_id, recipient_id, body, created_at)
         values ($1, $2, $3, now() - make_interval(mins => $4)) returning id`,
        [person.company_id, colleague.id, body, minutes]
      )
      return rows[0]!.id
    }
    const twentyMinutes = await aged(20, "past the edit window")
    assert(
      await refused(`update public.messages set body = 'too late' where id = $1`, [twentyMinutes]),
      "an edit MUST be refused more than 15 minutes after sending"
    )
    const withdrawLate = await attempt(`update public.messages set deleted_at = now() where id = $1`, [
      twentyMinutes,
    ])
    assert(withdrawLate.allowed, "a withdrawal MUST still be allowed inside the hour")
    const ninetyMinutes = await aged(90, "past the delete window")
    assert(
      await refused(`update public.messages set deleted_at = now() where id = $1`, [ninetyMinutes]),
      "a withdrawal MUST be refused more than an hour after sending"
    )
    console.log("  PASSED: 15 minutes to edit, an hour to withdraw, both refused after.")

    // -------------------------------------------------------------------------
    // TEST 5: 0030 — withdrawn hides the text without destroying it
    // -------------------------------------------------------------------------
    console.log("\nTest 5: Verifying a withdrawn message is hidden, not erased...")
    const withdraw = await attempt(`update public.messages set deleted_at = now() where id = $1`, [
      messageId,
    ])
    assert(withdraw.allowed, "the sender must be able to withdraw inside the hour")
    const { rows: shown } = await client.query<{ body: string | null }>(
      `select body from public.message_detail where id = $1`,
      [messageId]
    )
    assert.equal(shown[0]!.body, null, "message_detail MUST stop returning the text")
    const { rows: kept } = await client.query<{ body: string }>(
      `select body from public.messages where id = $1`,
      [messageId]
    )
    assert.equal(kept[0]!.body, "corrected text", "the row MUST still hold the text for the record")
    assert(
      await refused(`update public.messages set body = 'back again' where id = $1`, [messageId]),
      "a withdrawn message MUST NOT be editable afterwards"
    )
    const { rows: threads } = await client.query<{ t: unknown }>("select public.message_threads() as t")
    assert(
      JSON.stringify(threads[0]!.t).includes("This message was deleted"),
      "the inbox preview MUST stop quoting a withdrawn message"
    )
    console.log("  PASSED: the text is hidden from both parties and kept on the record.")

    // -------------------------------------------------------------------------
    // TEST 6: 0031 — an employee may store their own check-in photo
    // -------------------------------------------------------------------------
    console.log("\nTest 6: Verifying a non-HR employee can store their own attendance photo...")
    const jpeg = Buffer.from("ffd8ffe000104a464946", "hex")
    const insertFile = `
      insert into public.files (company_id, path, mime_type, size_bytes, data, uploaded_by)
      values ($1, $2, 'image/jpeg', $3, $4, $5) returning id`
    const own = await attempt(insertFile, [
      person.company_id,
      `attendance/${person.id}/${Date.now()}.jpg`,
      jpeg.length,
      jpeg,
      person.id,
    ])
    assert(own.allowed, `a ${person.role} MUST be able to store their own attendance photo`)
    const fileId = (own.rows[0] as { id: string }).id
    console.log(`  PASSED: a ${person.role} — not HR — can store their own.`)

    // -------------------------------------------------------------------------
    // TEST 7: 0031 — and nothing wider than that
    // -------------------------------------------------------------------------
    console.log("\nTest 7: Verifying the new write permission is no wider than one photo...")
    assert(
      await refused(insertFile, [
        person.company_id,
        `attendance/${colleague.id}/theirs.jpg`,
        jpeg.length,
        jpeg,
        person.id,
      ]),
      "an employee MUST NOT write into another employee's attendance folder"
    )
    assert(
      await refused(insertFile, [
        person.company_id,
        `employees/${person.id}/photo.jpg`,
        jpeg.length,
        jpeg,
        person.id,
      ]),
      "an employee MUST NOT write outside attendance/"
    )
    assert(
      await refused(insertFile, [
        person.company_id,
        `attendance/${person.id}/forged.jpg`,
        jpeg.length,
        jpeg,
        colleague.id,
      ]),
      "an employee MUST NOT attribute an upload to someone else"
    )
    assert(
      await refused(`update public.files set size_bytes = 1 where id = $1`, [fileId]),
      "an attendance photo MUST NOT be alterable by the person who uploaded it"
    )
    assert(
      await refused(`delete from public.files where id = $1`, [fileId]),
      "an attendance photo MUST NOT be deletable by the person who uploaded it"
    )
    console.log("  PASSED: own folder only, own name only, and immutable once written.")

    // -------------------------------------------------------------------------
    // TEST 8: 0031 — a check-in photo is not company-wide reading
    // -------------------------------------------------------------------------
    console.log("\nTest 8: Verifying a colleague cannot read someone's check-in photo...")
    const visibleTo = async (userId: number, companyId: number) => {
      await as(userId, companyId)
      const { rows } = await client.query<{ n: number }>(
        "select count(*)::int as n from public.files where id = $1",
        [fileId]
      )
      return rows[0]!.n
    }
    assert.equal(await visibleTo(person.id, person.company_id), 1, "the subject must be able to read it")
    assert.equal(
      await visibleTo(colleague.id, colleague.company_id),
      0,
      "a colleague MUST NOT be able to read someone else's attendance photo"
    )
    assert.equal(await visibleTo(hr.id, hr.company_id), 1, "HR must be able to read it to review attendance")
    console.log("  PASSED: the subject and HR only.")

    // -------------------------------------------------------------------------
    // TEST 9: 0031 — the restriction is confined to attendance photos
    // -------------------------------------------------------------------------
    console.log("\nTest 9: Verifying ordinary company files are unaffected by the restriction...")
    await as(hr.id, hr.company_id)
    const directoryPath = `employees/${person.id}/policy-test-${Date.now()}.jpg`
    const asHr = await attempt(insertFile, [
      hr.company_id,
      directoryPath,
      jpeg.length,
      jpeg,
      hr.id,
    ])
    assert(asHr.allowed, "HR must still be able to upload an ordinary company file")
    const directoryId = (asHr.rows[0] as { id: string }).id
    assert.equal(
      await visibleTo(colleague.id, colleague.company_id),
      0,
      "the attendance photo must still be hidden from the colleague"
    )
    await as(colleague.id, colleague.company_id)
    const { rows: ordinary } = await client.query<{ n: number }>(
      "select count(*)::int as n from public.files where id = $1",
      [directoryId]
    )
    assert.equal(ordinary[0]!.n, 1, "a non-attendance file MUST stay readable across the company")
    console.log("  PASSED: only attendance/ is narrowed; the rest of the table is as it was.")

    console.log("\n=== ALL MESSAGE + ATTENDANCE POLICY TESTS PASSED ===")
  } finally {
    // Nothing here is meant to survive: every row above exists only to be
    // refused or allowed, and a test that leaves a message in someone's inbox
    // is a test that cannot be run twice.
    await client.query("rollback")
    client.release()
    await pool.end()
  }
}

runTests().catch((err) => {
  console.error("\nTEST FAILED:", err)
  process.exit(1)
})
