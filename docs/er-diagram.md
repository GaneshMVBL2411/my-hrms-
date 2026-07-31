# HRMS — Entity Relationship Diagram

This covers the **Foundation** schema only (auth, roles/permissions, employees,
departments, designations, audit logs). Each later phase (Attendance, Leave,
Payroll, Projects, Tasks, Recruitment, Assets, Documents, Announcements) adds
its own tables + migration and extends this diagram.

Credentials live in Supabase Auth's `auth.users`; `public.users` holds the app's
own identity (integer id, role, active flag) and points at it via `auth_id`.

```mermaid
erDiagram
    ROLES ||--o{ USERS : "has"
    ROLES ||--o{ ROLE_PERMISSIONS : "grants"
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "granted via"

    AUTH_USERS ||--o| USERS : "authenticates"
    USERS ||--o| EMPLOYEES : "is"
    USERS ||--o{ AUDIT_LOGS : "performs"

    DEPARTMENTS ||--o{ EMPLOYEES : "groups"
    DESIGNATIONS ||--o{ EMPLOYEES : "titles"
    EMPLOYEES ||--o{ EMPLOYEES : "reports to (self-FK)"

    ROLES {
        int id PK
        string name
        string description
    }
    PERMISSIONS {
        int id PK
        string code
        string description
    }
    ROLE_PERMISSIONS {
        int role_id FK
        int permission_id FK
    }
    AUTH_USERS {
        uuid id PK "managed by Supabase Auth"
        string email
        string encrypted_password
    }
    USERS {
        int id PK
        uuid auth_id FK "-> auth.users.id"
        string email
        int role_id FK
        bool is_active
        datetime created_at
        datetime updated_at
    }
    DEPARTMENTS {
        int id PK
        string name
        string description
    }
    DESIGNATIONS {
        int id PK
        string title
        string description
    }
    EMPLOYEES {
        int id PK
        int user_id FK
        string employee_code
        string first_name
        string last_name
        string phone
        string address
        date dob
        string gender
        int department_id FK
        int designation_id FK
        int reporting_manager_id FK
        date joining_date
        string_array skills
        int experience_years
        string photo_url
        string status
        datetime created_at
        datetime updated_at
    }
    AUDIT_LOGS {
        int id PK
        int user_id FK
        string action
        string entity
        int entity_id
        json meta
        datetime created_at
    }
```

## Notes

- `users` holds auth identity (email/password/role); `employees` holds HR
  profile data and is 1:1 with `users` via `user_id`. Every employee is a
  user, but not every future user (e.g. a service account) needs to be an
  employee — hence the separate tables rather than one merged one.
- `employees.reporting_manager_id` is a self-referencing FK for the org
  hierarchy used by the reporting-manager field and (later) approval chains.
- `refresh_tokens` stores only a SHA-256 hash of the token, never the raw
  value, and is rotated on every `/auth/refresh` call.
- `audit_logs.meta` is a JSON column for action-specific context so the table
  doesn't need a migration every time a new auditable action is added.
