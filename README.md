# Find Your Next Book, Your Way

A composable, tag-based book discovery app. Search by author and genre at the same time, stacked as tags, with results narrowing live — no more choosing author *or* genre *or* title like Goodreads and library catalogs force you to.

## Status

🚧 V1 in progress. Core tag search first; AI-assisted discovery page deferred until built in-house (see [Roadmap](#roadmap)).

## Tech Stack

- **Backend:** FastAPI (Python)
- **Database:** Postgres, hosted on [Neon](https://neon.tech)
- **Frontend:** React
- **Hosting:** Vercel (frontend) + Render (backend)
- **Data source:** Curated dataset from Google Books API / Open Library API (no live-API calls at demo/runtime — avoids rate limits and uptime risk)

No authentication in V1 — no user accounts or saved data yet, so there's nothing to protect.

## Features (V1 Scope)

- [ ] Curated book/author/genre dataset loaded into Postgres
- [ ] Composable tag search: type → live suggestions → click to tag → results narrow instantly
- [ ] Stack multiple tags in any order (author + genre together)
- [ ] Browse-first option: see unfiltered results, add tags whenever

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- A free [Neon](https://neon.tech) Postgres database

### Setup
```bash
# clone the repo
git clone <your-repo-url>
cd <repo-name>

# backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# frontend
cd ../frontend
npm install
```

### Environment Variables
Create a `.env` file in `backend/` with:
```
DATABASE_URL=<your-neon-connection-string>
```

### Running locally
```bash
# backend (from backend/)
uvicorn main:app --reload

# frontend (from frontend/)
npm run dev
```

## Project Structure
```
.
├── backend/          # FastAPI app, Postgres models, routes
├── frontend/         # React app
├── data/             # scripts for pulling/loading curated dataset
├── docs/
│   └── schema.md     # database schema reference
└── README.md
```

## Database Schema

See [`docs/schema.md`](./docs/schema.md) for full table definitions and relationships (`books`, `authors`, `tags`, and their join tables).

## Roadmap

- **V1:** Tag search only, no AI, no auth
- **Later:** "Not Sure What to Read?" AI-assisted page — built in-house once NLP coursework supports it, not as a wrapped LLM API call
- **Later:** Own tag-based recommendation model (content-based / collaborative filtering)
- **Later:** User accounts, if saved books/personalization is added

## License

TBD
