from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.asset import Asset, AssetAssignment, AssetStatus
from app.schemas.asset import AssetAssignmentOut, AssetCreate, AssetOut, AssetUpdate


def _current_assignment(asset: Asset) -> AssetAssignment | None:
    for a in asset.assignments:
        if a.returned_date is None:
            return a
    return None


def to_out(asset: Asset) -> AssetOut:
    current = _current_assignment(asset)
    return AssetOut(
        id=asset.id,
        name=asset.name,
        category=asset.category,
        serial_number=asset.serial_number,
        purchase_date=asset.purchase_date,
        status=asset.status,
        notes=asset.notes,
        created_at=asset.created_at,
        assigned_to_name=current.employee.full_name if current else None,
    )


def _base_query():
    return select(Asset).options(joinedload(Asset.assignments).joinedload(AssetAssignment.employee))


def list_assets(
    db: Session, *, page: int, page_size: int, status: str | None, category: str | None, search: str | None
) -> tuple[list[Asset], int]:
    query = _base_query()
    if status:
        query = query.where(Asset.status == status)
    if category:
        query = query.where(Asset.category == category)
    if search:
        query = query.where(func.lower(Asset.name).like(f"%{search.lower()}%"))

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    query = query.order_by(Asset.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    assets = db.scalars(query).unique().all()
    return list(assets), total


def get_asset(db: Session, asset_id: int) -> Asset | None:
    return db.scalar(_base_query().where(Asset.id == asset_id))


def get_my_assets(db: Session, employee_id: int) -> list[AssetOut]:
    assets = db.scalars(
        _base_query().join(AssetAssignment, AssetAssignment.asset_id == Asset.id).where(
            AssetAssignment.employee_id == employee_id, AssetAssignment.returned_date.is_(None)
        )
    ).unique().all()
    return [to_out(a) for a in assets]


def create_asset(db: Session, payload: AssetCreate) -> Asset:
    asset = Asset(
        name=payload.name,
        category=payload.category,
        serial_number=payload.serial_number,
        purchase_date=payload.purchase_date,
        notes=payload.notes,
    )
    db.add(asset)
    db.commit()
    return get_asset(db, asset.id)  # type: ignore[return-value]


def update_asset(db: Session, asset: Asset, payload: AssetUpdate) -> Asset:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, key, value)
    db.commit()
    return get_asset(db, asset.id)  # type: ignore[return-value]


def delete_asset(db: Session, asset: Asset) -> None:
    db.delete(asset)
    db.commit()


def assign_asset(db: Session, asset: Asset, employee_id: int, notes: str | None) -> Asset:
    if asset.status != AssetStatus.AVAILABLE:
        raise ValueError(f"Asset is currently {asset.status.value} and cannot be assigned")

    db.add(
        AssetAssignment(
            asset_id=asset.id,
            employee_id=employee_id,
            assigned_date=datetime.now(timezone.utc).date(),
            notes=notes,
        )
    )
    asset.status = AssetStatus.ASSIGNED
    db.commit()
    return get_asset(db, asset.id)  # type: ignore[return-value]


def return_asset(db: Session, asset: Asset) -> Asset:
    current = _current_assignment(asset)
    if not current:
        raise ValueError("This asset is not currently assigned to anyone")

    current.returned_date = datetime.now(timezone.utc).date()
    asset.status = AssetStatus.AVAILABLE
    db.commit()
    return get_asset(db, asset.id)  # type: ignore[return-value]


def get_history(db: Session, asset_id: int) -> list[AssetAssignmentOut]:
    assignments = db.scalars(
        select(AssetAssignment)
        .options(joinedload(AssetAssignment.employee))
        .where(AssetAssignment.asset_id == asset_id)
        .order_by(AssetAssignment.assigned_date.desc())
    ).all()
    return [
        AssetAssignmentOut(
            id=a.id,
            employee_id=a.employee_id,
            employee_name=a.employee.full_name,
            assigned_date=a.assigned_date,
            returned_date=a.returned_date,
            notes=a.notes,
        )
        for a in assignments
    ]
