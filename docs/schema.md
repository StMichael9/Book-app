# Database Schema (V1 Draft)

This document defines the initial V1 schema for tag-based discovery.

## Core Tables

### `books`
- `id` (UUID, PK)
- `title` (TEXT, NOT NULL)
- `description` (TEXT, NULL)
- `published_year` (INT, NULL)
- `created_at` (TIMESTAMP, NOT NULL, default now)

### `authors`
- `id` (UUID, PK)
- `name` (TEXT, NOT NULL, UNIQUE)
- `created_at` (TIMESTAMP, NOT NULL, default now)

### `tags`
- `id` (UUID, PK)
- `name` (TEXT, NOT NULL)
- `tag_type` (TEXT, NOT NULL)  
  Allowed values in V1: `genre`, `topic`, `format`
- `created_at` (TIMESTAMP, NOT NULL, default now)

## Join Tables

### `book_authors`
- `book_id` (UUID, FK -> `books.id`, NOT NULL)
- `author_id` (UUID, FK -> `authors.id`, NOT NULL)
- Primary key: (`book_id`, `author_id`)

### `book_tags`
- `book_id` (UUID, FK -> `books.id`, NOT NULL)
- `tag_id` (UUID, FK -> `tags.id`, NOT NULL)
- Primary key: (`book_id`, `tag_id`)

## Relationship Summary

- A **book** can have many **authors**.
- An **author** can have many **books**.
- A **book** can have many **tags**.
- A **tag** can be reused across many **books**.

## Query Intent for Composable Search

Composable search should support intersecting filters:
- author name(s)
- tag name(s)

Result set should narrow as additional filters are applied.
