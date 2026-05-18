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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='product_investors' AND column_name='committed_amount') THEN
    ALTER TABLE product_investors ADD COLUMN committed_amount NUMERIC;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS declined_offers (
  id             SERIAL PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  investor_id    TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  decline_reason TEXT,
  declined_at    DATE DEFAULT CURRENT_DATE,
  UNIQUE(product_id, investor_id)
);

-- Rydd orphan-rader som ville hindre FK-constraint-migrasjoner under
DELETE FROM contact_log WHERE investor_id IS NOT NULL AND investor_id NOT IN (SELECT id FROM investors);
DELETE FROM tasks       WHERE investor_id IS NOT NULL AND investor_id NOT IN (SELECT id FROM investors);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'contact_log_investor_id_fkey' AND table_name = 'contact_log') THEN
    ALTER TABLE contact_log ADD CONSTRAINT contact_log_investor_id_fkey
      FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_investor_id_fkey' AND table_name = 'tasks') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_investor_id_fkey
      FOREIGN KEY (investor_id) REFERENCES investors(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='docs') THEN
    ALTER TABLE investors ADD COLUMN docs JSONB DEFAULT '{}';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='active') THEN
    ALTER TABLE contacts ADD COLUMN active INTEGER DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contact_log' AND column_name='status') THEN
    ALTER TABLE contact_log ADD COLUMN status TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contact_log' AND column_name='declined_products') THEN
    ALTER TABLE contact_log ADD COLUMN declined_products JSONB DEFAULT '[]';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='target_ticket') THEN
    ALTER TABLE investors DROP COLUMN target_ticket;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='probability') THEN
    ALTER TABLE investors DROP COLUMN probability;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='product_interests') THEN
    INSERT INTO product_investors (product_id, investor_id)
    SELECT (elem::text)::integer, id
    FROM investors, jsonb_array_elements(product_interests) AS elem
    WHERE product_interests IS NOT NULL AND jsonb_array_length(product_interests) > 0
    ON CONFLICT (product_id, investor_id) DO NOTHING;
    ALTER TABLE investors DROP COLUMN product_interests;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS backups (
  id          SERIAL PRIMARY KEY,
  stamp       TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(stamp, table_name)
);

CREATE INDEX IF NOT EXISTS idx_contact_log_investor_id  ON contact_log (investor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_investor_id        ON tasks (investor_id);
CREATE INDEX IF NOT EXISTS idx_product_investors_inv_id ON product_investors (investor_id);
CREATE INDEX IF NOT EXISTS idx_declined_offers_prod_id  ON declined_offers (product_id);
