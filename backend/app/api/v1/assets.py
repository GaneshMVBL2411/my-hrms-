from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.schemas.asset import (
    AssetAssign,
    AssetAssignmentOut,
    AssetCreate,
    AssetOut,
    AssetUpdate,
    PaginatedAssets,
)
from app.services import asset_service

router = APIRouter(prefix="/assets", tags=["assets"])

MANAGE_ROLES = ("founder", "hr_admin")


@router.get("", response_model=PaginatedAssets)
def list_assets(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100, alias="pageSize"),
    status_filter: str | None = Query(default=None, alias="status"),
    category: str | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = asset_service.list_assets(
        db, page=page, page_size=page_size, status=status_filter, category=category, search=search
    )
    return PaginatedAssets(
        items=[asset_service.to_out(a) for a in items], total=total, page=page, page_size=page_size
    )


@router.get("/mine", response_model=list[AssetOut])
def my_assets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not user.employee:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No employee profile linked to this account")
    return asset_service.get_my_assets(db, user.employee.id)


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    asset = asset_service.get_asset(db, asset_id)
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    return asset_service.to_out(asset)


@router.get("/{asset_id}/history", response_model=list[AssetAssignmentOut])
def asset_history(asset_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))):
    return asset_service.get_history(db, asset_id)


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(
    payload: AssetCreate, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))
):
    asset = asset_service.create_asset(db, payload)
    return asset_service.to_out(asset)


@router.patch("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: int,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    asset = asset_service.get_asset(db, asset_id)
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    asset = asset_service.update_asset(db, asset, payload)
    return asset_service.to_out(asset)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(asset_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))):
    asset = asset_service.get_asset(db, asset_id)
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    asset_service.delete_asset(db, asset)


@router.post("/{asset_id}/assign", response_model=AssetOut)
def assign_asset(
    asset_id: int,
    payload: AssetAssign,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(*MANAGE_ROLES)),
):
    asset = asset_service.get_asset(db, asset_id)
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    try:
        asset = asset_service.assign_asset(db, asset, payload.employee_id, payload.notes)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return asset_service.to_out(asset)


@router.post("/{asset_id}/return", response_model=AssetOut)
def return_asset(asset_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*MANAGE_ROLES))):
    asset = asset_service.get_asset(db, asset_id)
    if not asset:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    try:
        asset = asset_service.return_asset(db, asset)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return asset_service.to_out(asset)
