"""loads what fetch.py saved, and this is where you actually spend time in pandas:
 load it into a DataFrame, look at it, see what's missing, 
 what's messy, what needs fixing."""

import pandas as pd
import requests

df = pd.read_csv("patients.csv")

print(df.head())
print(df.info())
print(df.describe())

df.columns = df.columns.str.lower().str.replace(" ", "_")

df["height_cm"] = df["height_cm"].replace(0, None)
df["height_cm"] = df["height_cm"].fillna(df["height_cm"].median())
df = df.dropna(subset=["weight_kg"])
df["blood_pressure"] = df["blood_pressure"].replace("-999", None)
df["diagnosis"] = df["diagnosis"].replace("Unknown", None)

df = df.drop_duplicates()

df["date_of_visit"] = pd.to_datetime(df["date_of_visit"], errors="coerce")
df["diagnosis"] = df["diagnosis"].str.lower()

df = df[df["height_cm"] < 190]
df = df[df["weight_kg"] < 150]

df = df.dropna(subset=["blood_pressure"])

print(df)
