"""loads what fetch.py saved, and this is where you actually spend time in pandas:
 load it into a DataFrame, look at it, see what's missing, 
 what's messy, what needs fixing."""

import json
import requests

url = 'https://openlibrary.org/subjects/fantasy.json?limit=50'
data = requests.get(url).json()

with open("fantasy_raw.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)