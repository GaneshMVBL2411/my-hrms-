# Existing Usernames and Passwords

This document contains all existing user accounts and passwords from the HRMS codebase, seeds, and local database.

> [!NOTE]
> **Domain Spelling**: The correct domain spelling uses **two 'o's**: **`whhoohhpath.com`** (and employee address `kalyani.aiwhhoohh@gmail.com`).

---

## 1. Original / Existing Seed Credentials

These are the exact original seed usernames and passwords configured across the project migrations and seed files:

| Username / Email | Existing Password | Role | Organization / Company |
| :--- | :--- | :--- | :--- |
| **`ravi.shanker@whhoohhpath.com`** | `Founder@123` | **Founder** | Whhoohh Path LLP |
| **`hr@whhoohhpath.com`** | `HrAdmin@123` | **HR Admin** | Whhoohh Path LLP |
| **`ganesh.pm@whhoohhpath.com`** | `Manager@123` | **Project Manager** | Whhoohh Path LLP |
| **`tarak.lead@whhoohhpath.com`** | `TeamLead@123` | **Team Lead** | Whhoohh Path LLP |
| **`pavan.dev@whhoohhpath.com`** | `Employee@123` | **Employee (Dev)** | Whhoohh Path LLP |
| **`avinash.ai@whhoohhpath.com`** | `Employee@123` | **Employee (AI)** | Whhoohh Path LLP |
| **`kalyani.aiwhhoohh@gmail.com`** | `Kalyani@123` | **Employee** | Whhoohh Path LLP |
| **`admin@prozonic.com`** | `Prozonic@123` | **Company Admin** | Prozonic |
| **`admin@hrms.platform`** | `Platform@123` | **Super Admin** | Platform |

---

## 2. Active Local Test Password

If your database was updated via the local test script (`server/set-test-passwords.mjs`), all Whhoohhpath accounts also accept:

* **Password**: `Hrms@Whhoohh2026`

---

## 3. Account Details & Access Scope

* **`ravi.shanker@whhoohhpath.com`** (`Founder`): Full company administrative access, payroll runs, employee master data, statutory setup.
* **`hr@whhoohhpath.com`** (`HR Admin`): Employee management, document generator, leave approvals, attendance records.
* **`ganesh.pm@whhoohhpath.com`** (`Project Manager`): Project dashboards, sprint milestones, task assignments.
* **`tarak.lead@whhoohhpath.com`** (`Team Lead`): Team task boards, sprint progress tracking.
* **`pavan.dev@whhoohhpath.com`** (`Employee`): Self-service portal, check-in / check-out, personal payslips, leave requests.
* **`avinash.ai@whhoohhpath.com`** (`Employee`): Self-service portal, biometric punch, personal tasks.
* **`kalyani.aiwhhoohh@gmail.com`** (`Employee`): Self-service portal, letters, and personal attendance.
* **`admin@prozonic.com`** (`Company Admin`): Prozonic tenant administrator.
* **`admin@hrms.platform`** (`Super Admin`): Multi-tenant platform super-administrator.
