---
name: Market feed fallback semantics
description: Rules for truthful source freshness and historical market observations.
---

Only successful provider responses are historical market observations. Unconfigured feeds and maintained estimates must remain visible in the current snapshot but must not be stored as successful source history. When a provider fails, retain the latest successful observation and expose the failure state in the input metadata.

**Why:** Persisting fallback values as observations makes the backtest appear complete and can falsely promote an estimate to a cached market value.

**How to apply:** Any new market source should use the same live → cached last-success → explicit maintained fallback sequence, with provider credentials supplied through managed environment configuration.