# Pay & Plan — Standalone Rebuild

This is an independent, **Floot-free rebuild with AI screenshot reading** of the Pay & Plan personal finance dashboard, based on the original source of the owner's Floot project (snapshot October 14, 2026). The original app is not modified.

## Main features

- **React + TypeScript** UI with overview, income, plan, accounts, and spending pages.
- **FastAPI + SQLite** backend with local account registration, password hashing, HttpOnly session cookies, and user-isolated workspaces.
- Paycheck entry and revision history, gross/net weighted hourly calculations, regular-hour workweek calculations.
- Account balance history, credit-card reserves, planned income and expenses, tuition reserves, and rolling 30-day cash-flow forecasts.
- Monthly income/spending visualizations and Excel export.
- **Demo mode** uses fictional sample data and never writes into your private account.
- **NEW:** image upload → optional OpenAI vision extraction or free fictional mock → editable payroll draft (no automatic saving).
- Optimistic locking prevents silent overwrites when two tabs save competing changes.

## Run locally (Mac / Windows / Linux)

Requirements: Python 3.11+ and Node.js 20+.

Open two terminals in the project directory.

**Terminal 1 — API**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — React app**

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Choose "Explore with fictional demo data" for an immediate preview or register to save data in the backend's local SQLite database. `frontend/vite.config.ts` proxies `/api` requests to FastAPI.

The backend writes `backend/payplan.sqlite3` when needed. Back up this database to preserve your own records. It is excluded from the project ZIP.

## Tests

```bash
cd backend
pip install pytest httpx
pytest -q
```

To check the TypeScript frontend after installing dependencies:

```bash
cd frontend
npm run build
```

## What was reused and what was replaced

| Floot app behavior | This rebuild |
|---|---|
| Finance account/payroll/plan/spending data structures | Reconstructed with the same basic shape and major validation rules |
| 30-day cash forecasting rules | Ported from `financeMath.tsx`, including card and tuition reserves |
| Weighted hourly income metrics | Ported |
| Workweek average (date coverage) | Ported |
| React interface | New independent React/TypeScript design, similar information architecture |
| Floot backend, managed PostgreSQL, session machinery | Replaced by standalone FastAPI, SQLite, and local session cookies |
| Floot AI pay-slip photo extraction | **Rebuilt:** OpenAI image reading with strict structured results, mock mode, review-before-save. Requires your API key and billing. |
| Floot cloud photo/file storage | **Not implemented**; personal payslip photos are not imported |
| Import/claim original private workspace | **Not implemented**; real data should be migrated through an explicitly reviewed export/import flow |
| Excel export | Implemented for principal categories; export columns may differ from Floot |
| Automated validation/test suite | Backend tests included; frontend dependencies require `npm install` to build |

This is a functional reimplementation, **not** a pixel-for-pixel clone or a complete migration of every Floot-provided feature. Importantly, source code alone cannot recover actual database contents, users, uploaded private documents, credentials, or proprietary cloud services.

## Security and deployment notes

**Intended as a local development/portfolio project, not production-ready financial software.** Do not place it on the public internet unchanged. Before deploying: enforce HTTPS and secure cookies (`PAYPLAN_SECURE_COOKIE=true`), configure a trusted origin/CSRF policy, rate-limit authentication, configure a secrets policy, rotate sessions appropriately, and use managed storage/backups. Do not commit the SQLite database. When developing the public portfolio demo, use synthetic data only.

No Floot logo, API key, cloud credential, or private financial records are included. The original source archive was used solely as a reference for this independently implemented application.

## Where to start learning

- `frontend/src/finance.ts` — finance logic, models and demo values.
- `frontend/src/main.tsx` — UI components and data flow.
- `frontend/src/export.ts` — workbook export.
- `backend/app.py` — sessions, workspace validation, persistence and concurrency.
- `backend/test_app.py` — backend behavior tests.

## Recommended next steps

1. Run and review the fictional demo data.
2. Use the backend tests to understand how persistence works.
3. Add end-to-end browser tests for the UI.
4. Implement an opt-in data import from an exported Pay & Plan workbook.
5. Add AI-based pay-slip photo extraction with user-approved credentials, and store documents privately.

## NEW: AI pay-slip screenshot reader (October 2026)

### How to try it without paying for any API calls

1. Start the FastAPI backend and React frontend using the commands above.
2. At **http://localhost:5173**, choose **Explore with fictional demo data** (no account required), or sign in.
3. Click **Add paycheck** → **Choose paycheck image** and select any valid PNG/JPEG/WebP image (up to 10 MB). To avoid using a private document, you can choose `docs/sample_pay_stub_SYNTHETIC.png`.
4. Click **Try mock extraction · free**. The demo fills the payroll form with **fixed fictional numbers**, *not numbers extracted from your image*. Review the fields; click **Save changes** only if you want to save a draft.
5. In a signed-in workspace, you can instead use **Extract with OpenAI** for real screenshot extraction.

### Enable actual OpenAI vision extraction

Copy the example server-only environment file before you run FastAPI:

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` in VS Code and replace the placeholder with your own OpenAI API key:

```dotenv
OPENAI_API_KEY=your-api-key-here
PAYPLAN_AI_MODEL=gpt-4.1-mini
```

Your **ChatGPT subscription is separate from OpenAI API billing**. Configure API billing/usage limits in your API account, then start/restart the backend and sign in to Pay & Plan. **Never put the API key in frontend code or commit `.env` to Git.** To create a key and check billing, use https://platform.openai.com/.

The backend calls the OpenAI Responses API with an image and a strict Pydantic response schema. The extracted result contains amounts converted to integer CAD cents, dates, employer and warnings. It is always returned as a **draft**. You'll see an editable review form, including Quebec deductions (QPP/QPIP) and year-to-date figures. Only **Confirmed** paychecks count toward income totals. The upload is not persisted; the reviewed data is saved only when the user clicks the form's **Save changes** button.

**Privacy:** Upload files are validated and handled transiently (multipart upload processing may use a temporary spool file); they are never written to the app database or durable image storage. Image metadata is removed by re-encoding before calling the model. No screenshot, raw image or response is stored by our application. In real mode, the processed image is sent to OpenAI; review OpenAI API privacy terms and retention policies before sending sensitive pay stubs. Ideally crop or redact SIN, banking information, employee address and name first. `store=False` disables stored Responses but does not override every provider retention/security practice.

**Image limits:** JPEG, PNG, WebP; up to 10 MB and 24 megapixels. Screenshot quality matters. More than one pay stub per screenshot, unsupported currency, ambiguous fields and reconciliation differences trigger warnings. No values are silently computed to make the arithmetic balance.

**Important:** AI extraction is fallible. Always compare every value to the original before confirming. Mock mode **does not analyze images** and must not be treated as payroll data.

### Source walkthrough

- `backend/payroll_ai.py` — image sanitization, model instructions, Pydantic structured response, CAD cents, warning logic.
- `backend/app.py` — `/api/payroll/extract` endpoint; authentication and multipart upload validation.
- `frontend/src/main.tsx` — `PayrollScanner` component and editable integration into the existing payroll editor.
- `backend/test_payroll_ai.py` — mock mode, upload safety, login, API integration stub, draft behavior and validation tests.
- `docs/sample_pay_stub_SYNTHETIC.png` — entirely fictional example image for testing and demonstration.

Run tests with:

```bash
cd backend
python -m pip install -r requirements.txt pytest httpx
pytest -q
```

### Scope and limitations

This is a **local development MVP**, not production-hardened financial software. The AI flow has not been tested with a live API call in this environment (no user API key was provided). Additional protections such as HTTPS, origin/CSRF validation, per-user AI request rate limits, deployment secrets management and backup procedures are required before exposing it on the public internet.

## Fix for `Unexpected token 'I', "Internal Server Error" is not valid JSON`

This version fixes a reproducible import error when the backend is started from the project root, and makes backend failures show a readable error rather than a JSON parsing error. It does **not** guarantee OpenAI account billing or API-key configuration.

The FastAPI server can now be launched in either style:

```bash
# From the project root:
python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000

# OR from inside backend/:
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Only run one backend server at a time. Check `http://localhost:8000/api/health` (should return JSON with `"status":"ok"`). Try **mock extraction** first to test the app without any OpenAI API call. If mock works but OpenAI does not, check the backend terminal, then verify `backend/.env` includes a real key, billing is configured, and your model supports vision and structured outputs. Do not share your API key or unredacted pay slips.
