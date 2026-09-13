import assert from "node:assert/strict"
import "../env.js"
import { pool, withSession } from "../db.js"

async function main() {
  console.log("=== VERIFYING PLATFORM ONBOARDING & DYNAMIC SUBSCRIPTIONS ===")

  // Platform super admin is user #9 (admin@hrms.platform)
  const superAdminId = 9
  console.log("  Platform Super Admin ID:", superAdminId)

  try {
    await withSession({ userId: superAdminId, companyId: null }, async (client) => {
      // Test A: Create Company with flexible subscription fee (e.g. 7500.00, or any non-fixed amount)
      console.log("Test 1: Creating company with dynamic subscription fee & verified payment...")
      const testCode = "TST" + Math.floor(Math.random() * 1000)
      const testEmail = `admin@${testCode.toLowerCase()}.com`
      const createRes = await client.query<{ result: any }>(
        `select public.platform_create_company(
          p_name => $1,
          p_code => $2,
          p_admin_email => $3,
          p_admin_name => $4,
          p_admin_password => $5,
          p_monthly_price => $6,
          p_payment_status => $7,
          p_payment_reference => $8,
          p_modules => $9
        ) as result`,
        [
          "Test Dynamic Corp",
          testCode,
          testEmail,
          "Test Admin",
          "TestAdmin@2026!",
          7500.00, // Dynamic fee (not fixed)
          "verified",
          "UTR-TEST-12345",
          ["employees", "attendance", "leaves", "payroll", "company_bank"],
        ]
      )

      const created = createRes.rows[0]!.result
      console.log("  Created company:", created)
      assert.equal(created.code, testCode)
      assert.equal(created.status, "active")

      // Test B: Verify Company Overview returns enriched data
      console.log("Test 2: Verifying platform_company_overview contains dynamic fee and payment status...")
      const overviewRes = await client.query<{ result: any[] }>(
        `select public.platform_company_overview() as result`
      )
      const overview = overviewRes.rows[0]!.result
      const entry = overview.find((c: any) => c.code === testCode)
      assert(entry, "New company must appear in overview")
      assert.equal(Number(entry.monthly_price), 7500.00)
      assert.equal(entry.payment_status, "verified")
      assert.equal(entry.payment_reference, "UTR-TEST-12345")
      assert.equal(entry.admin_email, testEmail)
      assert.equal(entry.modules, 5)
      console.log("  Overview entry verified:", {
        code: entry.code,
        fee: entry.monthly_price,
        payment: entry.payment_status,
        modules: entry.modules,
      })

      // Test C: Update modules
      console.log("Test 3: Verifying platform_update_company_modules toggles access...")
      await client.query(
        `select public.platform_update_company_modules($1, $2)`,
        [created.company_id, ["employees", "attendance", "leaves", "payroll", "company_bank", "projects", "tasks"]]
      )
      const afterModules = await client.query(
        `select count(*) as cnt from company_modules where company_id = $1 and is_enabled = true`,
        [created.company_id]
      )
      assert.equal(Number(afterModules.rows[0].cnt), 7)
      console.log("  Updated to 7 modules verified.")

      // Test D: Update subscription fee dynamically (e.g. to 12000.00)
      console.log("Test 4: Verifying platform_update_subscription updates flexible fee...")
      await client.query(
        `select public.platform_update_subscription(
          p_company_id => $1,
          p_monthly_price => $2,
          p_payment_reference => $3
        )`,
        [created.company_id, 12000.00, "UTR-UPDATED-999"]
      )
      const subCheck = await client.query(
        `select monthly_price, payment_reference from company_subscriptions where company_id = $1`,
        [created.company_id]
      )
      assert.equal(Number(subCheck.rows[0].monthly_price), 12000.00)
      assert.equal(subCheck.rows[0].payment_reference, "UTR-UPDATED-999")
      console.log("  Updated fee to ₹12,000 verified.")

      // Throwing an abort error to trigger rollback in withSession so database stays clean
      throw new Error("ROLLBACK_TEST_INTENTIONAL")
    })
  } catch (err: any) {
    if (err.message === "ROLLBACK_TEST_INTENTIONAL") {
      console.log("  Transaction safely rolled back.")
      console.log("=== ALL PLATFORM ONBOARDING VERIFICATIONS PASSED ===")
    } else {
      throw err
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error("Test failed:", err)
  process.exit(1)
})
