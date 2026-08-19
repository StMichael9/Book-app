import pandas as pd
import matplotlib.pyplot as plt

# Reads the already-finished, already-validated dataset.
# This script does no cleaning or writing - it's exploration only,
# so it's safe to re-run any time without touching the pipeline output.

deduped = pd.read_json("json_data/books_combined.json")

# 1. Histogram of authors (counts of how many books each author has)
deduped['author'].value_counts().plot.hist()
plt.title("Distribution of Author Frequencies")
plt.xlabel("Number of Books")
plt.ylabel("Count of Authors")
plt.show()

# 2. Bar chart of top authors
deduped['author'].value_counts().head(20).plot.bar(figsize=(10, 5))
plt.title("Top 20 Most Frequent Authors")
plt.xlabel("Author")
plt.ylabel("Book Count")
plt.xticks(rotation=45)
plt.show()

# 3. Publish year distribution
deduped['first_publish_year'].dropna().plot.hist()
plt.title("Distribution of First Publish Years")
plt.xlabel("Year")
plt.ylabel("Count")
plt.show()