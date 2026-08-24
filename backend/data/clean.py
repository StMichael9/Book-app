import os
import time
import requests
import json
import pandas as pd

os.makedirs("json_data/raw", exist_ok=True)
os.makedirs("json_data/clean", exist_ok=True)


genres = [
    "fantasy", "mystery", "horror", "romance", "science_fiction",
    "thriller", "biography", "poetry", "history", "drama",
    "adventure", "humor", "classics", "young_adult", "philosophy",
]
headers = {"User-Agent": "book-discovery-app/0.1 (your-email@example.com)"}


def fetch_with_retry(url, headers, max_attempts=3, timeout=10):
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Attempt {attempt} failed for {url}: {e}")
            if attempt == max_attempts:
                raise
            time.sleep(2 * attempt)  # back off a bit longer each retry


for genre in genres:
    url = f"https://openlibrary.org/subjects/{genre}.json?limit=50"
    raw_file = f"json_data/raw/{genre}_raw.json"
    clean_file = f"json_data/clean/{genre}_clean.json"

    data = fetch_with_retry(url, headers)

    # Save raw file
    with open(raw_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Normalize into a DataFrame
    df = pd.json_normalize(data["works"])

    # Guard against a genre returning zero works. pd.json_normalize([])
    # produces a DataFrame with NO columns at all (not just zero rows),
    # so selecting ['title', 'authors', 'first_publish_year'] below would
    # raise a KeyError. Build an empty, correctly-shaped frame instead so
    # the pipeline degrades gracefully rather than crashing mid-loop.
    if df.empty:
        df_small = pd.DataFrame(columns=["title", "author", "first_publish_year", "cover_id"])
    else:
        if "cover_id" not in df.columns:
            df["cover_id"] = None

        df_small = df[['title', 'authors', 'first_publish_year', 'cover_id']].copy()

        # Replace year 0 with None
        df_small.loc[df_small['first_publish_year'] == 0, 'first_publish_year'] = None

        # For each row (x) in the authors column:
        # - Check if x is a list
        # - Check if the list is not empty
        # - If it has data, take the first dictionary and return its 'name'
        # - Otherwise return None
        df_small['author'] = df_small['authors'].apply(
            lambda x: x[0]['name'] if isinstance(x, list) and len(x) > 0 else None
        )
        df_small = df_small.drop(columns=['authors'])

    # Add genre tag
    df_small['genre'] = genre

    # Save cleaned file
    df_small.to_json(clean_file, orient="records", force_ascii=False)

    time.sleep(1)  # be polite to Open Library's shared infrastructure

# -------------------------
# COMBINE BLOCK (after loop)
# -------------------------

clean_files = [f"json_data/clean/{genre}_clean.json" for genre in genres]

dfs = [pd.read_json(f) for f in clean_files]
combined = pd.concat(dfs, ignore_index=True)


deduped = (
  combined.groupby(['title', 'author']).agg({
      "genre": list,
    "first_publish_year": "first",
    "cover_id": "first"
  }).reset_index()
)
print(deduped.isna().sum())

all_are_lists = deduped['genre'].apply(
    lambda x: isinstance(x, list)
).all()
print(f"Are all rows in the genre column lists? {all_are_lists}")

# -------------------------
# LANGUAGE FILTER (non-English titles)
# -------------------------
# Known, deliberate limitation: this is an ASCII-based heuristic, not real
# language detection. It correctly removes titles with non-Latin scripts
# (e.g. "Преступление и наказание", "Анна Каренина") but will NOT catch
# titles that happen to be fully ASCII despite being non-English (e.g.
# "Le petit prince"). Full language detection was already considered and
# rejected earlier in this project as unnecessary complexity for V1 - this
# filter accepts that same tradeoff, just now actually applied rather than
# left as an unaddressed known limitation.
before_count = len(deduped)
deduped = deduped[deduped['title'].apply(lambda t: str(t).isascii())].reset_index(drop=True)
removed_count = before_count - len(deduped)
print(f"Removed {removed_count} non-ASCII-title rows out of {before_count} (ASCII heuristic only, not full language detection).")

# Prevent malformed genres or typos from hitting Postgres
# Explode unrolls the inner lists to check every individual item
flat_genres = deduped['genre'].explode()
invalid_found = flat_genres[~flat_genres.isin(genres)].unique()

if len(invalid_found) > 0:
    print(f"❌ WARNING: Found invalid genres before Postgres load: {invalid_found}")
else:
    print("✅ Success: All inner list values belong strictly to your intended genres.")

print(deduped['first_publish_year'].dtype)

deduped.to_json("json_data/books_combined.json", orient="records", force_ascii=False)