"""Synthetic local DB integration. Catalogue transport is always mocked."""
import uuid

import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

@pytest.fixture
def reader(app_modules,db_session,monkeypatch):
    from auth.dependencies import get_current_user
    from rate_limit import limiter
    user=app_modules['models'].User(email=f'{uuid.uuid4()}@example.com',hashed_password='synthetic')
    db_session.add(user); db_session.commit()
    monkeypatch.setattr(app_modules['database'].settings,'reading_v3_enabled',True)
    monkeypatch.setattr(app_modules['database'].settings,'reading_v3_user_ids','')
    app_modules['main'].app.dependency_overrides[get_current_user]=lambda:user
    limiter.reset()
    yield user
    app_modules['main'].app.dependency_overrides.pop(get_current_user,None)
    db_session.rollback(); limiter.reset()


@pytest.fixture
def external(reader, app_modules, monkeypatch):
    from services.external_catalogue import catalogue
    settings=app_modules['database'].settings
    monkeypatch.setattr(settings,'external_catalogue_enabled',True)
    monkeypatch.setattr(settings,'external_catalogue_token',SecretStr('synthetic-test-token'))
    work={'source_id':'/works/OL1W','title':'Synthetic missing book','author':'Synthetic author',
          'cover_image_url':'https://covers.openlibrary.org/b/id/123-M.jpg','snapshot':'pinned'}
    monkeypatch.setattr(catalogue,'search',lambda *args:[work])
    monkeypatch.setattr(catalogue,'work',lambda *args:dict(work))
    return work


def select_book(client,work,request_id=None,**extra):
    return client.post('/me/catalogue/select',json={'source_id':work['source_id'],
        'request_id':request_id or str(uuid.uuid4()),'confirmed':True,**extra})


def test_selection_is_private_resumable_and_owner_scoped(client,external,reader,app_modules,db_session):
    models=app_modules['models']
    initial=db_session.scalar(select(func.count()).select_from(models.Book))
    request_id=str(uuid.uuid4())
    first=select_book(client,external,request_id)
    assert first.status_code==200, first.text
    item=first.json()
    assert item['book_id'] is None and item['is_wanted'] and not item['is_owned']
    assert item['private_title']==external['title']
    assert item['private_catalogue']['work_id']==external['source_id']
    assert item['private_catalogue']['cover_image_url']==external['cover_image_url']
    assert select_book(client,external,request_id).json()['id']==item['id']
    assert select_book(client,external).json()['id']==item['id']
    row=db_session.get(models.UserBook,item['id']); row.save_note='Keep my context'; row.is_wanted=False; row.status=None
    db_session.commit()
    again=select_book(client,external).json()
    assert again['save_note']=='Keep my context' and not again['is_wanted']
    assert db_session.scalar(select(func.count()).select_from(models.Book))==initial
    from auth.dependencies import get_current_user
    stranger=models.User(email=f'{uuid.uuid4()}@example.com',hashed_password='synthetic')
    db_session.add(stranger); db_session.commit()
    app_modules['main'].app.dependency_overrides[get_current_user]=lambda:stranger
    assert client.get(f"/me/library/{item['id']}").status_code==404
    assert select_book(client,external).json()['id']!=item['id']


def test_neon_duplicate_uses_existing_entry_without_overwrite(client,external,reader,db_session,app_modules,seeded_books):
    book=next(iter(seeded_books.values())); book.source_id=external['source_id']; db_session.commit()
    saved=client.put(f'/me/library/books/{book.id}',json={'is_owned':True}).json()
    result=select_book(client,external).json()
    assert result['id']==saved['id'] and result['is_owned'] and not result['is_wanted']
    assert client.get('/me/catalogue/search?title=Synthetic').json()['items']==[]


def test_off_unavailable_missing_and_unconfirmed_make_no_writes(client,external,app_modules,monkeypatch):
    from services.external_catalogue import catalogue,CatalogueUnavailable
    assert select_book(client,external,confirmed=False).status_code==422
    assert select_book(client,external,source_id='https://bad.example').status_code==422
    monkeypatch.setattr(app_modules['database'].settings,'external_catalogue_enabled',False)
    assert client.get('/me/catalogue/search?title=Book').json()['available'] is False
    assert select_book(client,external).status_code==503
    monkeypatch.setattr(app_modules['database'].settings,'external_catalogue_enabled',True)
    monkeypatch.setattr(catalogue,'work',lambda *args:None)
    assert select_book(client,external).status_code==404
    def unavailable(*args): raise CatalogueUnavailable()
    monkeypatch.setattr(catalogue,'search',unavailable)
    monkeypatch.setattr(catalogue,'work',unavailable)
    assert client.get('/me/catalogue/search?title=Book').json()['available'] is False
    assert select_book(client,external).status_code==503


def test_request_reuse_for_other_identity_is_rejected(client,external):
    request_id=str(uuid.uuid4())
    assert select_book(client,external,request_id).status_code==200
    external['source_id']='/works/OL2W'
    assert select_book(client,external,request_id).status_code==409


def test_auth_and_read_only_gates(client,external,app_modules,monkeypatch):
    from auth.dependencies import get_current_user
    app_modules['main'].app.dependency_overrides.pop(get_current_user,None)
    assert client.get('/me/catalogue/search?title=Book').status_code==401
    assert select_book(client,external).status_code==401


def test_disabled_reading_cannot_add_even_with_catalogue_enabled(client,external,app_modules,monkeypatch):
    monkeypatch.setattr(app_modules['database'].settings,'reading_v3_enabled',False)
    assert select_book(client,external).status_code==403


def test_concurrent_selections_are_one_entry(external,reader,app_modules,db_session):
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace
    from starlette.requests import Request
    from routes.catalogue import Selection,select_work
    owner=reader.id
    def save(_):
        with app_modules['database'].SessionLocal() as db:
            result=select_work.__wrapped__(request=Request({'type':'http','method':'POST','path':'/me/catalogue/select','headers':[]}),
                data=Selection(request_id=uuid.uuid4(),source_id=external['source_id'],confirmed=True),
                current_user=SimpleNamespace(id=owner),db=db)
            return result.id
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids=list(pool.map(save,range(2)))
    assert ids[0]==ids[1]
    model=app_modules['models'].UserBook
    assert db_session.scalar(select(func.count()).select_from(model).where(model.user_id==owner))==1


def test_committed_selection_retries_without_remote_or_token(client,external,app_modules,monkeypatch):
    from services.external_catalogue import catalogue
    request_id=str(uuid.uuid4())
    saved=select_book(client,external,request_id).json()
    monkeypatch.setattr(app_modules['database'].settings,'external_catalogue_token',None)
    def forbidden(*args): raise AssertionError('Committed retry must not contact the provider')
    monkeypatch.setattr(catalogue,'work',forbidden)
    assert select_book(client,external,request_id).json()['id']==saved['id']
    assert select_book(client,external).json()['id']==saved['id']
    assert select_book(client,external,request_id,source_id='/works/OL2W').status_code==409


def test_later_shared_identity_does_not_duplicate_private_history(client,external,reader,app_modules,db_session,monkeypatch):
    from services.external_catalogue import catalogue
    saved=select_book(client,external).json()
    db_session.add(app_modules['models'].Book(title=external['title'],source_id=external['source_id']))
    db_session.commit()
    def forbidden(*args): raise AssertionError('Local identity must win')
    monkeypatch.setattr(catalogue,'work',forbidden)
    result=select_book(client,external).json()
    assert result['id']==saved['id'] and result['book_id'] is None
    model=app_modules['models'].UserBook
    assert db_session.scalar(select(func.count()).select_from(model).where(model.user_id==reader.id))==1


def test_new_shared_entry_binds_uuid_and_reconciles_offline(client,external,reader,app_modules,db_session,monkeypatch):
    from services.external_catalogue import catalogue
    model=app_modules['models'].Book
    shared=model(title=external['title'],source_id=external['source_id'])
    db_session.add(shared); db_session.commit()
    request_id=str(uuid.uuid4())
    first=select_book(client,external,request_id)
    assert first.status_code==200,first.text
    assert first.json()['book_id']==shared.id
    monkeypatch.setattr(app_modules['database'].settings,'external_catalogue_token',None)
    def forbidden(*args): raise AssertionError('Shared replay is local')
    monkeypatch.setattr(catalogue,'work',forbidden)
    assert select_book(client,external,request_id).json()['id']==first.json()['id']
    assert select_book(client,external,request_id,source_id='/works/OL2W').status_code==409


def test_alias_shared_entry_replays_offline_without_overwriting(client,external,reader,app_modules,db_session,monkeypatch):
    from services.external_catalogue import catalogue
    alias='/works/OL2W'
    shared=app_modules['models'].Book(title=external['title'],source_id=external['source_id'])
    db_session.add(shared); db_session.commit()
    request_id=str(uuid.uuid4())
    first=select_book(client,external,request_id,source_id=alias)
    assert first.status_code==200,first.text
    saved=first.json()
    assert saved['book_id']==shared.id
    row=db_session.get(app_modules['models'].UserBook,saved['id'])
    row.save_note='Preserve my context'; row.is_owned=True; row.is_wanted=False; row.status=app_modules['models'].UserBookStatus.owned
    db_session.commit()
    monkeypatch.setattr(app_modules['database'].settings,'external_catalogue_token',None)
    def forbidden(*args): raise AssertionError('Alias retry must use the committed receipt')
    monkeypatch.setattr(catalogue,'work',forbidden)
    replay=select_book(client,external,request_id,source_id=alias)
    assert replay.status_code==200,replay.text
    assert replay.json()['id']==saved['id']
    assert replay.json()['save_note']=='Preserve my context'
    assert replay.json()['is_owned'] and not replay.json()['is_wanted']
    assert select_book(client,external,request_id,source_id='/works/OL3W').status_code==409
    model=app_modules['models'].UserBook
    assert db_session.scalar(select(func.count()).select_from(model).where(model.user_id==reader.id))==1


def test_dedup_happens_before_visible_limit(client,external,app_modules,db_session,monkeypatch):
    from services.external_catalogue import catalogue
    db_session.add(app_modules['models'].Book(title='Already shared',source_id='/works/OL1W'))
    db_session.commit()
    monkeypatch.setattr(catalogue,'search',lambda *args:[{**external,'source_id':f'/works/OL{n}W'} for n in range(1,32)])
    items=client.get('/me/catalogue/search?title=Synthetic').json()['items']
    assert len(items)==30
    assert items[-1]['source_id']=='/works/OL31W'
