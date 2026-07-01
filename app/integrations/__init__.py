"""External-system connectors that feed data *into* a FinLedger tenant.

Each connector is a standalone ``fetch -> map -> load`` job: it pulls records
from an outside institution, maps them onto balanced double-entry transactions,
and loads them through FinLedger's public REST API (``/v1/*``) using a tenant
API key. Connectors never touch the database directly, so they run against a
local or a deployed FinLedger instance without redeployment.
"""
