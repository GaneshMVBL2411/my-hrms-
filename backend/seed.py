"""Seed baseline reference data + Whhohh Path LLP's 7 employees.

Idempotent: safe to re-run against the same database.
"""

from datetime import date, timedelta

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.announcement import Announcement, AnnouncementCategory
from app.models.company_settings import CompanySettings
from app.models.department import Department
from app.models.designation import Designation
from app.models.document import Policy
from app.models.employee import Employee, EmployeeStatus, Gender
from app.models.leave import LeaveBalance, LeaveType
from app.models.payroll import SalaryStructure
from app.models.project import Priority, Project, ProjectMember, ProjectStatus
from app.models.role import Permission, Role, RolePermission
from app.models.task import Task, TaskChecklistItem, TaskStatus
from app.models.user import User

ROLES = ["founder", "hr_admin", "project_manager", "team_lead", "employee"]

PERMISSIONS = [
    "employees.manage",
    "employees.view",
    "projects.manage",
    "tasks.manage",
    "payroll.manage",
]

ROLE_PERMISSIONS = {
    "founder": PERMISSIONS,
    "hr_admin": ["employees.manage", "employees.view"],
    "project_manager": ["employees.view", "projects.manage", "tasks.manage"],
    "team_lead": ["employees.view", "tasks.manage"],
    "employee": ["employees.view"],
}

LEAVE_TYPES = [
    ("Casual Leave", 12),
    ("Sick Leave", 10),
    ("Paid Leave", 15),
    ("Work From Home", 24),
    ("Comp Off", 5),
]

DEPARTMENTS = ["Engineering", "Design", "AI/ML", "Operations"]
DESIGNATIONS = ["Founder & CEO", "Software Engineer", "Product Designer", "AI Engineer", "HR Executive"]

EMPLOYEES = [
    dict(
        email="ravi.shanker@whhohhpath.com",
        password="Founder@123",
        first_name="Ravi",
        last_name="Shanker",
        role="founder",
        department="Operations",
        designation="Founder & CEO",
        joining_date=date(2021, 1, 1),
        gender=Gender.MALE,
    ),
    dict(
        email="hr@whhohhpath.com",
        password="HrAdmin@123",
        first_name="Ananya",
        last_name="Rao",
        role="hr_admin",
        department="Operations",
        designation="HR Executive",
        joining_date=date(2022, 3, 15),
        gender=Gender.FEMALE,
    ),
    dict(
        email="karthik.pm@whhohhpath.com",
        password="Manager@123",
        first_name="Karthik",
        last_name="Iyer",
        role="project_manager",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2022, 6, 1),
        gender=Gender.MALE,
    ),
    dict(
        email="priya.lead@whhohhpath.com",
        password="TeamLead@123",
        first_name="Priya",
        last_name="Nair",
        role="team_lead",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2022, 9, 12),
        gender=Gender.FEMALE,
    ),
    dict(
        email="arjun.dev@whhohhpath.com",
        password="Employee@123",
        first_name="Arjun",
        last_name="Mehta",
        role="employee",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2023, 2, 20),
        gender=Gender.MALE,
    ),
    dict(
        email="sneha.design@whhohhpath.com",
        password="Employee@123",
        first_name="Sneha",
        last_name="Kapoor",
        role="employee",
        department="Design",
        designation="Product Designer",
        joining_date=date(2023, 5, 8),
        gender=Gender.FEMALE,
    ),
    dict(
        email="vikram.ai@whhohhpath.com",
        password="Employee@123",
        first_name="Vikram",
        last_name="Reddy",
        role="employee",
        department="AI/ML",
        designation="AI Engineer",
        joining_date=date(2023, 11, 3),
        gender=Gender.MALE,
    ),
]


def get_or_create(db, model, defaults=None, **kwargs):
    instance = db.scalar(select(model).filter_by(**kwargs))
    if instance:
        return instance, False
    instance = model(**kwargs, **(defaults or {}))
    db.add(instance)
    db.flush()
    return instance, True


def seed():
    db = SessionLocal()
    try:
        roles = {}
        for name in ROLES:
            role, _ = get_or_create(db, Role, name=name)
            roles[name] = role

        permissions = {}
        for code in PERMISSIONS:
            perm, _ = get_or_create(db, Permission, code=code)
            permissions[code] = perm

        for role_name, codes in ROLE_PERMISSIONS.items():
            for code in codes:
                get_or_create(
                    db, RolePermission, role_id=roles[role_name].id, permission_id=permissions[code].id
                )

        departments = {}
        for name in DEPARTMENTS:
            dept, _ = get_or_create(db, Department, name=name)
            departments[name] = dept

        designations = {}
        for title in DESIGNATIONS:
            desig, _ = get_or_create(db, Designation, title=title)
            designations[title] = desig

        db.commit()

        code_counter = 1001
        for emp_data in EMPLOYEES:
            existing_user = db.scalar(select(User).where(User.email == emp_data["email"]))
            if existing_user:
                print(f"Skipping existing user {emp_data['email']}")
                continue

            user = User(
                email=emp_data["email"],
                hashed_password=hash_password(emp_data["password"]),
                role_id=roles[emp_data["role"]].id,
            )
            db.add(user)
            db.flush()

            employee = Employee(
                user_id=user.id,
                employee_code=f"WP-{code_counter}",
                first_name=emp_data["first_name"],
                last_name=emp_data["last_name"],
                gender=emp_data["gender"],
                department_id=departments[emp_data["department"]].id,
                designation_id=designations[emp_data["designation"]].id,
                joining_date=emp_data["joining_date"],
                status=EmployeeStatus.ACTIVE,
                experience_years=2,
                skills=["Communication", "Teamwork"],
            )
            db.add(employee)
            code_counter += 1
            print(f"Created {emp_data['email']} ({emp_data['role']})")

        db.commit()

        leave_types = {}
        for name, default_days in LEAVE_TYPES:
            lt, _ = get_or_create(db, LeaveType, name=name, defaults={"default_days_per_year": default_days})
            leave_types[name] = lt
        db.commit()

        current_year = date.today().year
        employees = list(db.scalars(select(Employee)).all())
        for employee in employees:
            for leave_type in leave_types.values():
                get_or_create(
                    db,
                    LeaveBalance,
                    employee_id=employee.id,
                    leave_type_id=leave_type.id,
                    year=current_year,
                    defaults={"allocated_days": leave_type.default_days_per_year, "used_days": 0},
                )
        db.commit()

        by_first_name = {e.first_name: e for e in employees}
        founder_user = db.scalar(select(User).where(User.email == "ravi.shanker@whhohhpath.com"))
        pm_user = db.scalar(select(User).where(User.email == "karthik.pm@whhohhpath.com"))

        if founder_user and pm_user and not db.scalar(select(Project).where(Project.name == "HRMS Platform")):
            project = Project(
                name="HRMS Platform",
                description="Internal HR management system for Whhohh Path LLP.",
                tech_stack=["React", "FastAPI", "PostgreSQL"],
                priority=Priority.HIGH,
                status=ProjectStatus.ACTIVE,
                deadline=date.today() + timedelta(days=60),
                progress=35,
                created_by=founder_user.id,
            )
            db.add(project)
            db.flush()

            for name in ("Karthik", "Priya", "Arjun"):
                emp = by_first_name.get(name)
                if emp:
                    db.add(ProjectMember(project_id=project.id, employee_id=emp.id, role_in_project="Developer"))

            task1 = Task(
                project_id=project.id,
                title="Design database schema",
                description="Model core HR entities and relationships.",
                assigned_to=by_first_name["Priya"].id if "Priya" in by_first_name else None,
                priority=Priority.HIGH,
                due_date=date.today() + timedelta(days=5),
                status=TaskStatus.COMPLETED,
                created_by=pm_user.id,
            )
            task2 = Task(
                project_id=project.id,
                title="Build employee management UI",
                description="List, profile, and edit screens for employees.",
                assigned_to=by_first_name["Arjun"].id if "Arjun" in by_first_name else None,
                priority=Priority.MEDIUM,
                due_date=date.today() + timedelta(days=10),
                status=TaskStatus.IN_PROGRESS,
                created_by=pm_user.id,
            )
            db.add_all([task1, task2])
            db.flush()
            db.add(TaskChecklistItem(task_id=task2.id, label="List page", is_done=True))
            db.add(TaskChecklistItem(task_id=task2.id, label="Profile page", is_done=True))
            db.add(TaskChecklistItem(task_id=task2.id, label="Edit form", is_done=False))
            db.commit()
            print("Created sample project 'HRMS Platform' with tasks")

        role_basic_pay = {
            "founder": 150000,
            "hr_admin": 60000,
            "project_manager": 90000,
            "team_lead": 75000,
            "employee": 50000,
        }
        for employee in employees:
            basic = role_basic_pay[employee.user.role.name]
            get_or_create(
                db,
                SalaryStructure,
                employee_id=employee.id,
                defaults={
                    "basic": basic,
                    "hra": basic * 0.4,
                    "special_allowance": basic * 0.15,
                    "pf_percent": 12,
                    "esi_percent": 0.75,
                    "effective_from": employee.joining_date or date.today(),
                },
            )
        db.commit()
        print("Seeded salary structures.")

        get_or_create(
            db,
            CompanySettings,
            defaults={
                "company_name": "Whhohh Path LLP",
                "address": "Bengaluru, Karnataka, India",
            },
        )
        db.commit()

        if founder_user and not db.scalar(select(Policy).where(Policy.title == "Leave Policy")):
            db.add(
                Policy(
                    title="Leave Policy",
                    content=(
                        "All employees are entitled to Casual, Sick, Paid, Work From Home and "
                        "Comp Off leave as per their leave balance. Leave requests should be "
                        "submitted in advance via the Leaves module and require HR approval."
                    ),
                    updated_by=founder_user.id,
                )
            )
            db.add(
                Policy(
                    title="Code of Conduct",
                    content=(
                        "Employees are expected to act with integrity, respect colleagues, and "
                        "safeguard company and client data. Violations should be reported to HR."
                    ),
                    updated_by=founder_user.id,
                )
            )
            db.commit()
            print("Seeded sample policies.")

        hr_user = db.scalar(select(User).where(User.email == "hr@whhohhpath.com"))
        if hr_user and not db.scalar(select(Announcement).where(Announcement.title == "Welcome to the new HRMS")):
            db.add(
                Announcement(
                    title="Welcome to the new HRMS",
                    body="We've moved to a new in-house HR platform. Explore Attendance, Leaves, Projects, Tasks and more from the sidebar.",
                    category=AnnouncementCategory.NEWS,
                    pinned=True,
                    created_by=hr_user.id,
                )
            )
            db.add(
                Announcement(
                    title="Office closed for Independence Day",
                    body="The office will remain closed on August 15th for Independence Day.",
                    category=AnnouncementCategory.HOLIDAY,
                    pinned=False,
                    created_by=hr_user.id,
                )
            )
            db.commit()
            print("Seeded sample announcements.")

        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
