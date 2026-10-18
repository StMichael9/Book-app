"""Read-only Turso account checks and the user's 80%-of-Free safety ceiling.

No plan, billing, token or database management endpoint is writable here. The
provider meter can lag; local statement counters and a pre-request reserve are
additional conservative signals, not a promise about instantaneous billing.
"""
from __future__ import annotations

import json
import time
from urllib.request import Request, build_opener

from .storage import CatalogueError, RejectRedirects

FREE_LIMITS = {'storage_bytes': 5_000_000_000, 'rows_written': 10_000_000,
               'rows_read': 500_000_000, 'bytes_synced': 3_000_000_000}
PLAN_KEYS = {'storage_bytes': 'storage', 'rows_written': 'rowsWritten',
             'rows_read': 'rowsRead', 'bytes_synced': 'bytesSynced'}
RESERVE = {'storage_bytes': 16_000_000, 'rows_written': 100_000,
           'rows_read': 1_000_000, 'bytes_synced': 1_000_000}


class QuotaPaused(CatalogueError):
    """A safety pause is not permission to retry, reset or increase limits."""


class Account:
    def __init__(self, token):
        if not token:
            raise QuotaPaused('The approved temporary usage-monitor token is required')
        self.token = token
        self.opener = build_opener(RejectRedirects())

    def get(self, endpoint):
        if endpoint not in ('subscription', 'plans', 'usage'):
            raise ValueError('Only the three approved read-only account endpoints are allowed')
        request = Request('https://api.turso.tech/v1/organizations/stmichael9/' + endpoint,
                          headers={'Authorization': 'Bearer ' + self.token}, method='GET')
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read(1_000_001)
            if len(raw) > 1_000_000:
                raise ValueError('Oversized account response')
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError('Invalid account response')
            return value
        except Exception:
            raise QuotaPaused('Account usage could not be verified; import paused without retrying writes') from None

    def limits(self):
        subscription = self.get('subscription').get('subscription', {})
        if (subscription.get('overages') is not False
                or subscription.get('plan') not in ('starter', 'free')
                or subscription.get('timeline') != 'monthly'):
            raise QuotaPaused('Free monthly plan with paid overages OFF was not confirmed')
        plans = self.get('plans').get('plans', [])
        plan = next((item for item in plans if item.get('name') == subscription['plan']), None)
        if not plan or str(plan.get('price')) not in ('0', '0.0', '0.00'):
            raise QuotaPaused('The current plan was not confirmed as zero-cost')
        limits = {}
        for key, field in PLAN_KEYS.items():
            value = plan.get('quotas', {}).get(field)
            if type(value) is not int or value <= 0:
                raise QuotaPaused('Complete current Free allowances could not be verified')
            # A larger advertised plan must never silently expand authorization.
            limits[key] = min(value, FREE_LIMITS[key])
        return limits

    def usage(self):
        value = self.get('usage').get('organization', {}).get('usage', {})
        result = {}
        for key in FREE_LIMITS:
            if type(value.get(key)) is not int or value[key] < 0:
                raise QuotaPaused('Complete account-wide usage could not be verified')
            result[key] = value[key]
        return result


class Guard:
    def __init__(self, account, store, *, clock=time.monotonic, emit=None):
        self.account, self.store, self.clock = account, store, clock
        self.emit = emit or (lambda value: print(json.dumps(value, sort_keys=True), flush=True))
        self.limits = account.limits()
        self.initial = dict(account.usage())
        self.reported = dict(self.initial)
        self.read_start, self.write_start = store.rows_read, store.rows_written
        self.last_poll = self.last_plan = clock()
        self.highwater = dict(self.initial)
        self.announced = {key: 0 for key in FREE_LIMITS}
        self.check(force=True)

    def check(self, *, force=False):
        now = self.clock()
        if force or now - self.last_plan >= 300:
            self.limits = self.account.limits()
            self.last_plan = now
        if force or now - self.last_poll >= 30:
            self.reported = dict(self.account.usage())
            self.last_poll = now
        usage = dict(self.reported)
        usage['rows_read'] = max(usage['rows_read'], self.initial['rows_read'] +
                                 self.store.rows_read - self.read_start)
        usage['rows_written'] = max(usage['rows_written'], self.initial['rows_written'] +
                                    self.store.rows_written - self.write_start)
        for key, value in usage.items():
            # Meter/reset regression never gives this job a fresh allowance.
            self.highwater[key] = max(value, self.highwater[key])
            percent = 100 * self.highwater[key] // self.limits[key]
            for threshold in range(self.announced[key] + 10, min(80, percent) + 1, 10):
                self.emit({'event': 'quota_threshold', 'resource': key, 'percent': threshold,
                           'used': self.highwater[key], 'allowance': self.limits[key]})
                self.announced[key] = threshold
        exhausted = [key for key in FREE_LIMITS if
                     self.highwater[key] + RESERVE[key] >= self.limits[key] * 80 // 100]
        if exhausted:
            self.emit({'event': 'quota_stop', 'ceiling_percent': 80, 'resources': exhausted,
                       'used': self.highwater, 'limits': self.limits,
                       'reason': '80% ceiling or reserved next-request headroom reached'})
            raise QuotaPaused('80% Free-allowance ceiling/headroom reached; no automatic continuation authorized')
        return {'event': 'account_usage', 'overages': False, 'used': dict(self.highwater),
                'reported': dict(self.reported), 'limits': dict(self.limits), 'ceiling_percent': 80}
