---
name: Market API codegen compatibility
description: Integer response schemas can generate unsupported zod.int() calls in this workspace.
---

When extending the generated API contract, use numeric response fields for integer-like values unless the installed Zod/Orval combination is confirmed to support zod.int().

**Why:** The workspace currently resolves a Zod version whose runtime namespace lacks `int`, while Orval emits `zod.int()` for OpenAPI integer response schemas; codegen succeeds but the library typecheck fails.

**How to apply:** Keep integer validation on query parameters where generated coercion supports it, but prefer `type: number` for response counts, horizons, and indexes when adding new endpoints.