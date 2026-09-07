# Existing System Accounts & Passwords

This document lists all **existing usernames and passwords** across the HRMS system.

---

## 1. Original Existing Credentials (Codebase Seed)

These are the original existing passwords created for each account in the repository schema and migrations:

| Email / Username | Existing Password | Role | Organization |
| :--- | :--- | :--- | :--- |
| **`ravi.shanker@whhoohhpath.com`** | `Founder@123` | **Founder** | Whhoohhpath |
| **`hr@whhoohhpath.com`** | `HrAdmin@123` | **HR Admin** | Whhoohhpath |
| **`ganesh.pm@whhoohhpath.com`** | `Manager@123` | **Project Manager** | Whhoohhpath |
| **`tarak.lead@whhoohhpath.com`** | `TeamLead@123` | **Team Lead** | Whhoohhpath |
| **`pavan.dev@whhoohhpath.com`** | `Employee@123` | **Employee (Dev)** | Whhoohhpath |
| **`avinash.ai@whhoohhpath.com`** | `Employee@123` | **Employee (AI)** | Whhoohhpath |
| **`kalyani.aiwhhoohh@gmail.com`** | `Kalyani@123` | **Employee** | Whhoohhpath |
| **`admin@prozonic.com`** | `Prozonic@123` | **Company Admin** | Prozonic |
| **`admin@hrms.platform`** | `Platform@123` | **Super Admin** | Platform Level |

---

## 2. Active Local Development Password

The local database test setup script (`server/set-test-passwords.mjs`) synchronizes all active Whhoohhpath accounts to:

* **Password**: `Hrms@Whhoohh2026`

---

## 3. Role Access Overview

* **Founder (`ravi.shanker@whhoohhpath.com`)**: Complete access across every module, payroll runs, settings, and company management.
* **HR Admin (`hr@whhoohhpath.com`)**: Employee onboarding, leave approvals, attendance records, letters/documents generation.
* **Project Manager (`ganesh.pm@whhoohhpath.com`)**: Projects, sprint boards, task creation and assignment.
* **Team Lead (`tarak.lead@whhoohhpath.com`)**: Team task tracking and sprint progress.
* **Employees (`pavan.dev`, `avinash.ai`, `kalyani`)**: Self-service portal: check-in/out, biometric punch, leave requests, personal payslips.
* **Platform Admin (`admin@hrms.platform`)**: Super admin over platform and subscriptions.
