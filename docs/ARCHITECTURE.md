# Standalone architecture

```
React + TypeScript (Vite, port 5173)
      |
      | /api via Vite development proxy
      v
FastAPI (port 8000)
      |
      | sqlite3 + parameterized queries
      v
Local SQLite database (users, sessions, workspaces)
```

The workspace JSON model is intentionally close to the original Floot application's schema so its finance-calculation functions remain explainable.

- **Payroll history:** draft, confirmed, superseded, void. Confirmed items may change only to statuses that preserve their full original content. Corrections create a revised record instead of silently replacing history.
- **Forecast:** dated snapshot → cash and card balance → planned transactions → 30-day daily available cash → required cash buffer.
- **Storage:** one JSON workspace per signed-in user; optimistic version check rejects stale edits (HTTP 409).
- **Authentication:** email/password with PBKDF2 hashing; random session token stored only as SHA-256 digest; HttpOnly SameSite=Strict cookie.
- **Floot dependencies removed:** @floot/storage, @floot/ai, project-dependent endpoints and internal import claims. AI photo reading is not part of this version.

This structure favors a simple, verifiable local development experience over reproducing cloud-only behavior.
