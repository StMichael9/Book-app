"""A small in-process cache for anonymous catalogue reads (book pages and list pages).

A hit costs no database round trip, which matters when each one is about 60 ms. It is never used for signed-in
responses (those are personalised), is capped, and is emptied by any catalogue write the API performs. Entries also
expire on their own, so the importer (a separate process) is picked up within the time to live.
"""
import threading
import time
from collections import OrderedDict

MAX_ENTRIES = 2000
BOOK_TTL = 10 * 60
LIST_TTL = 60

_lock = threading.Lock()
_entries: OrderedDict = OrderedDict()


def get(key):
    with _lock:
        entry = _entries.get(key)
        if entry is None:
            return None
        if entry[0] <= time.monotonic():
            del _entries[key]
            return None
        _entries.move_to_end(key)
        return entry[1]


def put(key, value, ttl):
    with _lock:
        _entries[key] = (time.monotonic() + ttl, value)
        _entries.move_to_end(key)
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)


def drop_prefix(prefix: tuple):
    with _lock:
        for key in [key for key in _entries if isinstance(key, tuple) and key[:len(prefix)] == prefix]:
            del _entries[key]


def clear():
    with _lock:
        _entries.clear()


def size():
    with _lock:
        return len(_entries)
