from sqlalchemy import select, delete
from sqlalchemy.orm import Session, selectinload
from fastapi import HTTPException, status

from models import UserPreference, Tag


class UserPreferenceService:
    def __init__(self, db: Session):
        self.db = db

    def set_preferences(self, user_id, tag_ids: list[int], source_text: str | None = None) -> list[UserPreference]:
        tag_ids = list(dict.fromkeys(tag_ids))  # dedupe, preserves order

        if tag_ids:
            found_ids = set(
                self.db.execute(select(Tag.id).where(Tag.id.in_(tag_ids))).scalars().all()
            )
            missing = set(tag_ids) - found_ids
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unknown tag_id(s): {sorted(missing)}"
                )

        self.db.execute(delete(UserPreference).where(UserPreference.user_id == user_id))

        new_prefs = [
            UserPreference(user_id=user_id, tag_id=tag_id, source_text=source_text)
            for tag_id in tag_ids
        ]
        self.db.add_all(new_prefs)
        self.db.commit()

        return self.get_preferences(user_id)

    def get_preferences(self, user_id) -> list[UserPreference]:
        query = (
            select(UserPreference)
            .where(UserPreference.user_id == user_id)
            .options(selectinload(UserPreference.tag))
        )
        return self.db.execute(query).scalars().all()