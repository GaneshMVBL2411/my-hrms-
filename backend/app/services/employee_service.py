from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.security import hash_password
from app.models.department import Department
from app.models.designation import Designation
from app.models.employee import Employee, EmployeeStatus
from app.models.role import Role
from app.models.user import User
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeSummaryOut, EmployeeUpdate

SORTABLE_COLUMNS = {
    "fullName": Employee.first_name,
    "firstName": Employee.first_name,
    "joiningDate": Employee.joining_date,
    "employeeCode": Employee.employee_code,
    "status": Employee.status,
}


def _base_query():
    return select(Employee).options(
        joinedload(Employee.user),
        joinedload(Employee.department),
        joinedload(Employee.designation),
        joinedload(Employee.reporting_manager),
    )


def to_summary(emp: Employee) -> EmployeeSummaryOut:
    return EmployeeSummaryOut(
        id=emp.id,
        employee_code=emp.employee_code,
        full_name=emp.full_name,
        email=emp.user.email,
        phone=emp.phone,
        address=emp.address,
        photo_url=emp.photo_url,
        department_id=emp.department_id,
        department_name=emp.department.name if emp.department else None,
        designation_id=emp.designation_id,
        designation_title=emp.designation.title if emp.designation else None,
        status=emp.status,
        joining_date=emp.joining_date,
    )


def to_detail(emp: Employee) -> EmployeeOut:
    return EmployeeOut(
        **to_summary(emp).model_dump(by_alias=False),
        first_name=emp.first_name,
        last_name=emp.last_name,
        dob=emp.dob,
        gender=emp.gender,
        reporting_manager_id=emp.reporting_manager_id,
        reporting_manager_name=emp.reporting_manager.full_name if emp.reporting_manager else None,
        skills=emp.skills or [],
        experience_years=emp.experience_years,
        pan_number=emp.pan_number,
        aadhaar_number=emp.aadhaar_number,
        bank_account_number=emp.bank_account_number,
        bank_ifsc=emp.bank_ifsc,
        bank_name=emp.bank_name,
        created_at=emp.created_at,
    )


def generate_employee_code(db: Session) -> str:
    count = db.scalar(select(func.count()).select_from(Employee)) or 0
    return f"WP-{count + 1001}"


def list_employees(
    db: Session,
    *,
    page: int,
    page_size: int,
    search: str | None,
    department_id: int | None,
    designation_id: int | None,
    status: str | None,
    sort_by: str,
    sort_dir: str,
) -> tuple[list[Employee], int]:
    query = _base_query()

    if search:
        pattern = f"%{search.lower()}%"
        query = query.join(Employee.user).where(
            func.lower(Employee.first_name + " " + Employee.last_name).like(pattern)
            | func.lower(User.email).like(pattern)
            | func.lower(Employee.employee_code).like(pattern)
        )

    if department_id:
        query = query.where(Employee.department_id == department_id)
    if designation_id:
        query = query.where(Employee.designation_id == designation_id)
    if status:
        query = query.where(Employee.status == status)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0

    sort_col = SORTABLE_COLUMNS.get(sort_by, Employee.first_name)
    order = sort_col.desc() if sort_dir == "desc" else sort_col.asc()
    query = query.order_by(order).offset((page - 1) * page_size).limit(page_size)

    items = list(db.scalars(query).unique().all())
    return items, total


def get_employee(db: Session, employee_id: int) -> Employee | None:
    return db.scalar(_base_query().where(Employee.id == employee_id))


def create_employee(db: Session, payload: EmployeeCreate) -> Employee:
    role = db.scalar(select(Role).where(Role.name == payload.role))
    if role is None:
        raise ValueError(f"Unknown role: {payload.role}")

    if db.scalar(select(User).where(User.email == payload.email)):
        raise ValueError(f"An account with email {payload.email} already exists")

    user = User(email=payload.email, hashed_password=hash_password(payload.password), role_id=role.id)
    db.add(user)
    db.flush()

    employee = Employee(
        user_id=user.id,
        employee_code=generate_employee_code(db),
        first_name=payload.first_name,
        last_name=payload.last_name,
        phone=payload.phone,
        address=payload.address,
        dob=payload.dob,
        gender=payload.gender,
        department_id=payload.department_id,
        designation_id=payload.designation_id,
        reporting_manager_id=payload.reporting_manager_id,
        joining_date=payload.joining_date,
        skills=payload.skills,
        experience_years=payload.experience_years,
        pan_number=payload.pan_number,
        aadhaar_number=payload.aadhaar_number,
        bank_account_number=payload.bank_account_number,
        bank_ifsc=payload.bank_ifsc,
        bank_name=payload.bank_name,
        status=payload.status,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return get_employee(db, employee.id)  # type: ignore[return-value]


def update_employee(db: Session, employee: Employee, payload: EmployeeUpdate) -> Employee:
    data = payload.model_dump(exclude_unset=True, by_alias=False)

    if "role" in data:
        role_name = data.pop("role")
        if role_name:
            role = db.scalar(select(Role).where(Role.name == role_name))
            if role is None:
                raise ValueError(f"Unknown role: {role_name}")
            employee.user.role_id = role.id

    for key, value in data.items():
        setattr(employee, key, value)

    db.commit()
    db.refresh(employee)
    return get_employee(db, employee.id)  # type: ignore[return-value]


def delete_employee(db: Session, employee: Employee) -> None:
    employee.status = EmployeeStatus.INACTIVE
    employee.user.is_active = False
    db.commit()


def list_departments(db: Session) -> list[Department]:
    return list(db.scalars(select(Department).order_by(Department.name)).all())


def create_department(db: Session, name: str, description: str | None) -> Department:
    department = Department(name=name, description=description)
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


def update_department(db: Session, department: Department, data: dict) -> Department:
    for key, value in data.items():
        setattr(department, key, value)
    db.commit()
    db.refresh(department)
    return department


def delete_department(db: Session, department: Department) -> None:
    db.delete(department)
    db.commit()


def list_designations(db: Session) -> list[Designation]:
    return list(db.scalars(select(Designation).order_by(Designation.title)).all())


def create_designation(db: Session, title: str, description: str | None) -> Designation:
    designation = Designation(title=title, description=description)
    db.add(designation)
    db.commit()
    db.refresh(designation)
    return designation


def update_designation(db: Session, designation: Designation, data: dict) -> Designation:
    for key, value in data.items():
        setattr(designation, key, value)
    db.commit()
    db.refresh(designation)
    return designation


def delete_designation(db: Session, designation: Designation) -> None:
    db.delete(designation)
    db.commit()
