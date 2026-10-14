"""Pay & Plan standalone API — independent of Floot.

Local-first personal financial workspace. This implementation intentionally does not
include the original user's private financial data, Floot credentials, or image storage.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response, File, UploadFile, Query
from fastapi.responses import JSONResponse
import logging
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

APP_DIR = Path(__file__).resolve().parent
from dotenv import load_dotenv
load_dotenv(APP_DIR / ".env")
DB_PATH = Path(os.getenv("PAYPLAN_DB_PATH", str(APP_DIR / "payplan.sqlite3")))
COOKIE_SECURE = os.getenv("PAYPLAN_SECURE_COOKIE", "false").lower() == "true"
SESSION_SECONDS = 60 * 60 * 24 * 7
_lock = threading.RLock()
app = FastAPI(title="Pay & Plan Standalone API", version="1.0.1")
logger = logging.getLogger("payplan.api")


@app.exception_handler(Exception)
async def unexpected_server_error(request: Request, exc: Exception):
    """Return JSON even for unexpected failures; detailed diagnostics stay server-side."""
    logger.exception("Unexpected error in %s (%s)", request.url.path, type(exc).__name__)
    return JSONResponse(
        status_code=500,
        content={"detail": "Unexpected backend error. Check the FastAPI terminal for the traceback.", "code": "INTERNAL_SERVER_ERROR"},
    )



def money(value: Any, *, allow_null: bool = True) -> int | None:
    if value is None and allow_null:
        return None
    if type(value) is not int or not 0 <= value <= 10_000_000_000:
        raise ValueError("Money values must be integer cents from 0 to 10,000,000,000")
    return value


def date_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Expected a date in YYYY-MM-DD format")
    date.fromisoformat(value)
    return value


def require_valid_workspace(data: Any) -> dict[str, Any]:
    """Ported from financeModel.tsx including status and referential invariants."""
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise ValueError("Invalid finance workspace version")
    required = {"accounts", "snapshots", "payrolls", "plan", "settings"}
    if not required.issubset(data):
        raise ValueError("Workspace is missing required fields")
    limits = {"accounts": 50, "snapshots": 3000, "payrolls": 3000, "plan": 300, "spending": 600}
    for k, maximum in limits.items():
        arr = data.get(k, [])
        if not isinstance(arr, list) or len(arr) > maximum:
            raise ValueError(f"Invalid {k} records")
        if any(not isinstance(r, dict) or not isinstance(r.get("id"), str) or not r["id"] for r in arr):
            raise ValueError(f"Invalid IDs in {k}")
        if len({r["id"] for r in arr}) != len(arr):
            raise ValueError(f"Duplicate record IDs in {k}")
    account_ids = set()
    for a in data["accounts"]:
        if not isinstance(a, dict) or not isinstance(a.get("id"), str) or not a["id"] or a.get("kind") not in {"cash", "investment", "credit_card", "loan"}:
            raise ValueError("Invalid account")
        if not isinstance(a.get("name"), str) or not 1 <= len(a["name"].strip()) <= 80:
            raise ValueError("Invalid account name")
        account_ids.add(a["id"])
    for s in data["snapshots"]:
        date_or_none(s.get("date"))
        if not isinstance(s.get("balances"), dict):
            raise ValueError("Invalid balance snapshot")
        for aid, value in s["balances"].items():
            if aid not in account_ids or (value is not None and (type(value) is not int or abs(value) > 10_000_000_000)):
                raise ValueError("Invalid balance value or reference")
            kind = next(a["kind"] for a in data["accounts"] if a["id"] == aid)
            if value is not None and value < 0 and kind in {"credit_card", "loan"}:
                raise ValueError("Enter debt as a positive amount owed")
    paydates = set()
    cents_keys = ["gross", "net", "withheld", "hours", "regular", "tips", "vacation", "holiday", "otherEarnings", "federalTax", "quebecTax", "ei", "qpip", "qpp", "qppExtra", "otherDeductions", "ytdGross", "ytdNet", "ytdWithheld"]
    for p in data["payrolls"]:
        if p.get("status") not in {"draft", "confirmed", "superseded", "void"}:
            raise ValueError("Invalid payroll status")
        for k in ("payDate", "periodStart", "periodEnd"):
            date_or_none(p.get(k))
        if p.get("periodStart") and p.get("periodEnd") and p["periodStart"] > p["periodEnd"]:
            raise ValueError("Pay period ends before it starts")
        for k in cents_keys:
            money(p.get(k))
        if p["status"] == "confirmed":
            if not p.get("employer") or not p.get("payDate") or any(p.get(k) is None for k in ("gross", "net", "withheld")):
                raise ValueError("Employer, pay date, gross, net and withheld are required")
            if abs(p["gross"] - p["withheld"] - p["net"]) > 1:
                raise ValueError("Gross minus withheld must equal net pay")
            key = (p["employer"].casefold(), p["payDate"])
            if key in paydates:
                raise ValueError("Duplicate employer/pay date among confirmed payrolls")
            paydates.add(key)
    for p in data["plan"]:
        if p.get("kind") not in {"bill", "flexible", "tuition", "payroll", "bursary", "loan_in", "debt_payment", "other_in", "other_out"}:
            raise ValueError("Invalid plan kind")
        if p.get("category") not in {"essentials", "other", "education", "funding", "debt"}:
            raise ValueError("Invalid plan category")
        if p.get("frequency") not in {"once", "monthly", "biweekly", "weekly"}:
            raise ValueError("Invalid frequency")
        if p.get("status") not in {"expected", "confirmed", "completed", "cancelled"}:
            raise ValueError("Invalid plan status")
        if p.get("accountId") and p["accountId"] not in account_ids:
            raise ValueError("Planned payment references an unknown account")
        date_or_none(p.get("nextDate"))
        money(p.get("amount"))
        money(p.get("reserved"), allow_null=False)
    for s in data.get("spending", []):
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", s.get("month", "")):
            raise ValueError("Invalid spending month")
        for k in ("living", "tuition", "budget"):
            money(s.get(k), allow_null=False)
    settings = data["settings"]
    if not isinstance(settings, dict) or type(settings.get("scheduleReviewed")) is not bool:
        raise ValueError("Invalid forecast settings")
    money(settings.get("buffer"))
    return data


def empty_workspace() -> dict[str, Any]:
    return {"schemaVersion": 1, "accounts": [
        {"id": "chequing", "name": "Chequing", "kind": "cash"},
        {"id": "savings", "name": "Savings", "kind": "cash"},
        {"id": "card", "name": "Credit card", "kind": "credit_card"}
    ], "snapshots": [], "payrolls": [], "plan": [], "spending": [], "settings": {"buffer": None, "scheduleReviewed": False}}


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        conn = sqlite3.connect(str(DB_PATH), timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
        finally:
            conn.close()


def init_db():
    with database() as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          pass_salt TEXT NOT NULL,
          pass_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspaces (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data TEXT NOT NULL,
          version INTEGER NOT NULL
        );
        """)


@app.on_event("startup")
def startup():
    init_db()


class Credentials(BaseModel):
    email: str = Field(min_length=4, max_length=254)
    password: str = Field(min_length=10, max_length=200)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        v = value.strip().casefold()
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("Enter a valid email")
        return v


def hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 350_000).hex()


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: sqlite3.Connection, user_id: int, res: Response):
    token = secrets.token_urlsafe(40)
    db.execute("DELETE FROM sessions WHERE user_id=? OR expires_at < ?", (user_id, int(time.time())))
    db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (digest_token(token), user_id, int(time.time()) + SESSION_SECONDS))
    res.set_cookie("payplan_session", token, max_age=SESSION_SECONDS, httponly=True, secure=COOKIE_SECURE, samesite="strict", path="/")


def current_user(request: Request) -> sqlite3.Row:
    token = request.cookies.get("payplan_session")
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    with database() as db:
        user = db.execute("SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at > ?", (digest_token(token), int(time.time()))).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Your session has expired")
    return user


@app.post("/api/auth/register", status_code=201)
def register(creds: Credentials, response: Response):
    salt = secrets.token_bytes(16)
    with database() as db:
        try:
            cur = db.execute("INSERT INTO users(email,pass_salt,pass_hash,created_at) VALUES(?,?,?,?)", (creds.email, salt.hex(), hash_password(creds.password, salt), datetime.now(timezone.utc).isoformat()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "This email is already registered")
        create_session(db, cur.lastrowid, response)
        return {"id": cur.lastrowid, "email": creds.email}


@app.post("/api/auth/login")
def login(creds: Credentials, response: Response):
    with database() as db:
        user = db.execute("SELECT * FROM users WHERE email=?", (creds.email,)).fetchone()
        check = hash_password(creds.password, bytes.fromhex(user["pass_salt"])) if user else hash_password(creds.password, b"0" * 16)
        if not user or not hmac.compare_digest(check, user["pass_hash"]):
            raise HTTPException(401, "Incorrect email or password")
        create_session(db, user["id"], response)
        return {"id": user["id"], "email": user["email"]}


@app.get("/api/auth/me")
def me(request: Request):
    return dict(current_user(request))


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("payplan_session")
    if token:
        with database() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest_token(token),))
    response.delete_cookie("payplan_session", path="/")
    return {"ok": True}


class StateUpdate(BaseModel):
    version: int = Field(ge=0)
    data: dict[str, Any]


@app.get("/api/state")
def get_state(request: Request):
    user = current_user(request)
    with database() as db:
        row = db.execute("SELECT * FROM workspaces WHERE user_id=?", (user["id"],)).fetchone()
    return {"data": json.loads(row["data"]) if row else empty_workspace(), "version": row["version"] if row else 0}


@app.put("/api/state")
def put_state(req: StateUpdate, request: Request):
    user = current_user(request)
    try:
        data = require_valid_workspace(req.data)
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(422, str(error))
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            old = db.execute("SELECT * FROM workspaces WHERE user_id=?", (user["id"],)).fetchone()
            old_version = old["version"] if old else 0
            if req.version != old_version:
                raise HTTPException(409, "Your records changed in another window; refresh first")
            if old:
                previous = json.loads(old["data"])
                next_by_id = {p["id"]: p for p in data["payrolls"]}
                for p in previous["payrolls"]:
                    if p["status"] == "draft":
                        continue
                    candidate = next_by_id.get(p["id"])
                    if candidate is None or {**p, "status": candidate["status"]} != candidate or candidate["status"] == "draft":
                        raise HTTPException(422, "Confirmed payroll must be preserved; create a revision instead")
                db.execute("UPDATE workspaces SET data=?, version=? WHERE user_id=?", (json.dumps(data, separators=(",", ":")), old_version + 1, user["id"]))
            else:
                db.execute("INSERT INTO workspaces(user_id,data,version) VALUES(?,?,1)", (user["id"], json.dumps(data, separators=(",", ":"))))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
    return {"version": old_version + 1}


@app.get("/api/health")
def health():
    return {"status": "ok", "database": "sqlite"}


@app.post("/api/payroll/extract")
async def extract_paycheck(request: Request, file: UploadFile = File(...), mode: str = Query("openai", pattern="^(openai|mock)$")):
    """Return a reviewable DRAFT. Never persist or log uploaded image bytes.

    Mock mode is allowed in the anonymous demo, but returns fixed fictional
    numbers and does NOT interpret the uploaded screenshot.
    """
    # Support both startup commands:
    # cd backend && uvicorn app:app
    # project root && uvicorn backend.app:app
    if __package__:
        from . import payroll_ai
    else:
        import payroll_ai
    if mode == "openai":
        current_user(request)
        if not os.getenv("OPENAI_API_KEY", "").strip():
            raise HTTPException(503, "Set OPENAI_API_KEY in backend/.env before using real AI extraction")
    if (file.content_type or "").lower() not in payroll_ai.SUPPORTED_TYPES:
        raise HTTPException(415, "Only JPEG, PNG, or WebP images are accepted")
    # Stream with an early hard limit so a client cannot send an unbounded upload.
    size, chunks = 0, []
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > payroll_ai.MAX_UPLOAD:
            raise HTTPException(413, "Screenshot exceeds the 10 MB upload limit")
        chunks.append(chunk)
    await file.close()
    cleaned_image = payroll_ai.normalize_image(b"".join(chunks), file.content_type.lower())
    del chunks
    if mode == "mock":
        extracted = payroll_ai.mock_fields()
    else:
        try:
            extracted = await __import__("asyncio").to_thread(payroll_ai.call_openai, cleaned_image)
        except Exception as exc:
            # Deliberately avoid returning provider exception strings: they may
            # include sensitive details. Missing SDK used to cause an uncaught
            # ModuleNotFoundError *inside this exception handler* (HTTP 500).
            if isinstance(exc, ModuleNotFoundError) and exc.name == "openai":
                raise HTTPException(503, "OpenAI Python SDK is not installed in the running backend. Activate the backend virtual environment, run: python -m pip install -r requirements.txt, then restart FastAPI.") from None
            try:
                from openai import AuthenticationError, RateLimitError, APIConnectionError, APIStatusError
            except ImportError:
                raise HTTPException(503, "OpenAI SDK is unavailable in the active Python environment. Reinstall backend dependencies and restart FastAPI.") from None
            if isinstance(exc, AuthenticationError):
                raise HTTPException(502, "OpenAI rejected the API key. Check your backend .env") from None
            if isinstance(exc, RateLimitError):
                raise HTTPException(429, "OpenAI rate limit or credit limit reached. Try later") from None
            if isinstance(exc, (APIConnectionError, APIStatusError)):
                raise HTTPException(502, "OpenAI couldn't process the image. Try again later") from None
            raise HTTPException(502, "AI extraction could not be completed. You can enter the amounts manually") from None
    return payroll_ai.make_draft(extracted, mock=(mode == "mock"))
