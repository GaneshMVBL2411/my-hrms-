from datetime import date, datetime

from pydantic import EmailStr

from app.models.employee import EmployeeStatus, Gender
from app.schemas.base import CamelModel


class DepartmentOut(CamelModel):
    id: int
    name: str
    description: str | None = None


class DepartmentCreate(CamelModel):
    name: str
    description: str | None = None


class DepartmentUpdate(CamelModel):
    name: str | None = None
    description: str | None = None


class DesignationOut(CamelModel):
    id: int
    title: str
    description: str | None = None


class DesignationCreate(CamelModel):
    title: str
    description: str | None = None


class DesignationUpdate(CamelModel):
    title: str | None = None
    description: str | None = None


class EmployeeSummaryOut(CamelModel):
    id: int
    employee_code: str
    full_name: str
    email: EmailStr
    phone: str | None
    address: str | None
    photo_url: str | None
    department_id: int | None
    department_name: str | None
    designation_id: int | None
    designation_title: str | None
    status: EmployeeStatus
    joining_date: date | None


class EmployeeOut(EmployeeSummaryOut):
    first_name: str
    last_name: str
    dob: date | None
    gender: Gender | None
    reporting_manager_id: int | None
    reporting_manager_name: str | None
    skills: list[str]
    experience_years: int | None
    pan_number: str | None
    aadhaar_number: str | None
    bank_account_number: str | None
    bank_ifsc: str | None
    bank_name: str | None
    created_at: datetime


class EmployeeCreate(CamelModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    role: str = "employee"
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    gender: Gender | None = None
    department_id: int | None = None
    designation_id: int | None = None
    reporting_manager_id: int | None = None
    joining_date: date | None = None
    skills: list[str] | None = None
    experience_years: int | None = None
    pan_number: str | None = None
    aadhaar_number: str | None = None
    bank_account_number: str | None = None
    bank_ifsc: str | None = None
    bank_name: str | None = None
    status: EmployeeStatus = EmployeeStatus.ACTIVE


class EmployeeUpdate(CamelModel):
    first_name: str | None = None
    last_name: str | None = None
    role: str | None = None
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    gender: Gender | None = None
    department_id: int | None = None
    designation_id: int | None = None
    reporting_manager_id: int | None = None
    joining_date: date | None = None
    skills: list[str] | None = None
    experience_years: int | None = None
    pan_number: str | None = None
    aadhaar_number: str | None = None
    bank_account_number: str | None = None
    bank_ifsc: str | None = None
    bank_name: str | None = None
    status: EmployeeStatus | None = None


class PaginatedEmployees(CamelModel):
    items: list[EmployeeSummaryOut]
    total: int
    page: int
    page_size: int
