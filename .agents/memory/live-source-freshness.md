---
name: Live source freshness
description: Freshness indicators must distinguish source cadence from a genuinely new value during the current session.
---

Market inputs should remain visually unearned after page load and only become active when a refreshed response carries a source timestamp newer than the session start; elapsed time alone is not evidence of freshness.

**Why:** Steel indices may update weekly or monthly, so turning a badge green after a timer would make cached data look live and undermine the model's trust signal.

**How to apply:** Poll at a modest cadence, keep each input's cadence and next expected update visible, and explain the state with source and timestamp details on hover/click.