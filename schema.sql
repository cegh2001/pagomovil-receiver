-- Schema for PagoMóvil Receiver (Cloudflare D1 SQLite)

CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank TEXT NOT NULL,
    amount_bs REAL NOT NULL,
    raw_amount TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    phone_prefix TEXT,
    phone_last_digits TEXT,
    reference TEXT,
    date TEXT NOT NULL,
    time TEXT,
    raw_title TEXT,
    raw_body TEXT,
    received_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for searching references with suffix matching (e.g. BDV)
CREATE INDEX IF NOT EXISTS idx_pagos_reference ON pagos(reference);

-- Index for searching by phone last digits + amount (e.g. BFC without reference)
CREATE INDEX IF NOT EXISTS idx_pagos_phone_amount ON pagos(phone_last_digits, amount_bs, used);

-- Unique index to prevent duplicate ingestion for banks with reference numbers
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_unique_ref ON pagos(reference, amount_bs, date)
WHERE reference IS NOT NULL;

-- Unique index fallback for banks without reference (BFC) using phone, amount, and raw notification body
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_unique_noref ON pagos(phone_number, amount_bs, date, raw_body)
WHERE reference IS NULL;
