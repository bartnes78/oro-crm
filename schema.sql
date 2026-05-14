-- ORO CRM — PostgreSQL-skjema
-- Kjøres automatisk ved oppstart (CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS investors (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  country         TEXT DEFAULT 'Norge',
  city            TEXT,
  investor_type   TEXT,
  fund_vehicle    TEXT,
  product_interests JSONB DEFAULT '[]',
  phase           TEXT DEFAULT 'Prospekt',
  lead            TEXT,
  advisor         TEXT,
  target_ticket   NUMERIC,
  probability     NUMERIC,
  first_close     INTEGER DEFAULT 0,
  source          TEXT,
  next_steps      TEXT,
  last_contact    DATE,
  doc_shared      DATE,
  meeting_date    DATE,
  comments        TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  investor_id TEXT REFERENCES investors(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  title       TEXT,
  email       TEXT,
  phone       TEXT,
  is_primary  INTEGER DEFAULT 0,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS contact_log (
  id             SERIAL PRIMARY KEY,
  investor_id    TEXT,
  investor_name  TEXT,
  date           DATE NOT NULL,
  log_type       TEXT,
  contact_person TEXT,
  responsible    TEXT,
  subject        TEXT,
  outcome        TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id             SERIAL PRIMARY KEY,
  investor_id    TEXT,
  investor_name  TEXT,
  label          TEXT NOT NULL,
  due_date       DATE NOT NULL,
  done           INTEGER DEFAULT 0,
  created_at     DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT,
  status      TEXT,
  target_size NUMERIC,
  description TEXT
);

CREATE TABLE IF NOT EXISTS product_investors (
  id             SERIAL PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  investor_id    TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  target_ticket  NUMERIC,
  probability    NUMERIC,
  decline_reason TEXT,
  UNIQUE(product_id, investor_id)
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  role          TEXT DEFAULT 'bruker',
  password_hash TEXT NOT NULL
);

-- Legg til FK-er på eksisterende databaser (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'product_investors_product_id_fkey' AND table_name = 'product_investors') THEN
    ALTER TABLE product_investors ADD CONSTRAINT product_investors_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'product_investors_investor_id_fkey' AND table_name = 'product_investors') THEN
    ALTER TABLE product_investors ADD CONSTRAINT product_investors_investor_id_fkey
      FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE;
  END IF;
END $$;
