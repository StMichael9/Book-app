from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from database import get_db
from services import seo

router = APIRouter(tags=["seo"])
XML = "application/xml; charset=utf-8"
DAY = "public, max-age=86400"


@router.get("/sitemaps/index.xml")
def sitemap_index(db: Session = Depends(get_db)):
    return Response(seo.sitemap_index_xml(db), media_type=XML, headers={"Cache-Control": DAY})


@router.get("/sitemaps/books-{n}.xml")
def sitemap_chunk(n: int, db: Session = Depends(get_db)):
    body = seo.sitemap_chunk_xml(db, n)
    if body is None:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(body, media_type=XML, headers={"Cache-Control": DAY})


@router.get("/seo/book/{book_id}")
def book_page(book_id: int, db: Session = Depends(get_db)):
    """A book's page with its head tags and a plain-HTML summary filled in, for crawlers that do not run JavaScript.
    Readers inside the app never come here. An unknown or unlisted book gets the untouched page and a 404."""
    index = seo.deployed_index()
    if index is None:
        return Response("Temporarily unavailable", status_code=503, media_type="text/plain", headers={"Cache-Control": "no-store"})
    facts = seo.book_facts(db, book_id)
    if facts is None:
        return Response(index, status_code=404, media_type="text/html; charset=utf-8", headers={"Cache-Control": "public, max-age=60"})
    return Response(seo.render_book_page(index, facts), media_type="text/html; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=300"})
