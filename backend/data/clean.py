import os
import time
import requests
import json
import pandas as pd

os.makedirs("json_data/raw", exist_ok=True)
os.makedirs("json_data/clean", exist_ok=True)


genres = ["fantasy", "mystery", "horror", "romance", "science_fiction"]
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
    df_small = df[['title', 'authors', 'first_publish_year']].copy()

    # Replace year 0 with None
    df_small.loc[df_small['first_publish_year'] == 0, 'first_publish_year'] = None


    # Inspect
    print(df_small.info())
    print(df_small.head())
    print(df_small.describe())

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

clean_files = [
    "json_data/clean/fantasy_clean.json",
    "json_data/clean/mystery_clean.json",
    "json_data/clean/horror_clean.json",
    "json_data/clean/romance_clean.json",
    "json_data/clean/science_fiction_clean.json"
]

dfs = [pd.read_json(f) for f in clean_files]
combined = pd.concat(dfs, ignore_index=True)


deduped = (
  combined.groupby(['title', 'author']).agg({
      "genre": list,
    "first_publish_year": "first" 
  }).reset_index()  
)
print(deduped.isna().sum())

all_are_lists  = deduped['genre'].apply(
    lambda x: isinstance(x, list)
).all()
print(f"Are all rows in the genre column lists? {all_are_lists}")

# Prevent malformed genres or typos from hitting Postgres
# Explode unrolls the inner lists to check every individual item
flat_genres = deduped['genre'].explode()
invalid_found = flat_genres[~flat_genres.isin(genres)].unique()

if len(invalid_found) > 0:
    print(f"❌ WARNING: Found invalid genres before Postgres load: {invalid_found}")
else:
    print("✅ Success: All inner list values belong strictly to your 5 intended genres.")

print(deduped['first_publish_year'].dtype)

deduped.to_json("json_data/books_combined.json", orient="records", force_ascii=False)

