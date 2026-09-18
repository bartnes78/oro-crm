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

-- Fasemigrering: frikoble fase fra tegningsstatus
UPDATE investors SET phase = 'Prospekt'           WHERE phase IN ('Ny kontakt');
UPDATE investors SET phase = 'Aktiv dialog'       WHERE phase IN ('Intro sendt', 'Møte avtalt');
UPDATE investors SET phase = 'Investor'           WHERE phase IN ('Tegnet', 'Onboardet');
UPDATE investors SET phase = 'På vent'            WHERE phase IN ('Ikke relevant nå');

CREATE INDEX IF NOT EXISTS idx_contact_log_investor_id  ON contact_log (investor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_investor_id        ON tasks (investor_id);
CREATE INDEX IF NOT EXISTS idx_product_investors_inv_id ON product_investors (investor_id);
CREATE INDEX IF NOT EXISTS idx_declined_offers_prod_id  ON declined_offers (product_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='must_change_password') THEN
    ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Ansvarlig for oppgave (lead-navn). Frontend har alltid sendt/vist feltet;
-- kolonnen manglet, så verdien ble stille droppet ved lagring.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='tasks' AND column_name='responsible') THEN
    ALTER TABLE tasks ADD COLUMN responsible TEXT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS feedback_reports (
  id         SERIAL PRIMARY KEY,
  page       TEXT,
  comment    TEXT NOT NULL,
  screenshot TEXT,
  username   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Behandlet-markering (beholder historikk i stedet for å slette)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='feedback_reports' AND column_name='resolved_at') THEN
    ALTER TABLE feedback_reports ADD COLUMN resolved_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='feedback_reports' AND column_name='resolved_by') THEN
    ALTER TABLE feedback_reports ADD COLUMN resolved_by TEXT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER,
  username    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  old_value   JSONB,
  new_value   JSONB,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON audit_log (entity_type, entity_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='deleted_at') THEN
    ALTER TABLE investors ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_investors_deleted_at ON investors (deleted_at) WHERE deleted_at IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='org_nr') THEN
    ALTER TABLE investors ADD COLUMN org_nr TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='brreg_navn') THEN
    ALTER TABLE investors ADD COLUMN brreg_navn TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='brreg_data') THEN
    ALTER TABLE investors ADD COLUMN brreg_data JSONB DEFAULT '{}';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='source') THEN
    ALTER TABLE contacts ADD COLUMN source TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contacts' AND column_name='phone2') THEN
    ALTER TABLE contacts ADD COLUMN phone2 TEXT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_investors_org_nr ON investors (org_nr) WHERE org_nr IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='established_date') THEN
    ALTER TABLE products ADD COLUMN established_date DATE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='lead_name') THEN
    ALTER TABLE users ADD COLUMN lead_name TEXT UNIQUE;
  END IF;
END $$;

-- Lead sourcing: rå, ukvalifiserte prospekter (staging). Skjules fra operative
-- visninger via is_lead IS NOT TRUE; promoteres ved å sette is_lead = FALSE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='is_lead') THEN
    ALTER TABLE investors ADD COLUMN is_lead BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='finansinntekt_mnok') THEN
    ALTER TABLE investors ADD COLUMN finansinntekt_mnok NUMERIC;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='kapitalkilde') THEN
    ALTER TABLE investors ADD COLUMN kapitalkilde TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='relevans_indikativ') THEN
    ALTER TABLE investors ADD COLUMN relevans_indikativ TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='provenance') THEN
    ALTER TABLE investors ADD COLUMN provenance JSONB DEFAULT '{}';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_investors_is_lead ON investors (is_lead) WHERE is_lead = TRUE;

-- Relaterte selskaper: én person → flere selskaper (rolle/relasjon). Aktivitet spores
-- mot ett hovedselskap (relation='hovedselskap'), men koblingen synliggjør resten.
CREATE TABLE IF NOT EXISTS persons (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  kapital_id  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_name ON persons (name);

CREATE TABLE IF NOT EXISTS person_companies (
  person_id    INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  investor_id  TEXT REFERENCES investors(id) ON DELETE SET NULL,  -- NULL = ikke i CRM ennå
  company_name TEXT NOT NULL,
  org_nr       TEXT,
  relation     TEXT,            -- 'hovedselskap' | 'investeringsselskap' | 'eiendom' | 'konsern' | 'familie' | 'annet'
  rolle        TEXT,            -- 'Styreleder', 'Daglig leder', ...
  source       TEXT,
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (person_id, company_name)
);
CREATE INDEX IF NOT EXISTS idx_person_companies_investor ON person_companies (investor_id);

-- Assosierte selskaper: direkte selskap-til-selskap-kobling (uten person-hub). Symmetrisk —
-- lagres kanonisk med a_id < b_id, og vises på begge kortene. relation = fri etikett
-- (assosiert/kontaktpunkt/konsern/eiendom/annet).
CREATE TABLE IF NOT EXISTS investor_associations (
  a_id       TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  b_id       TEXT NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  relation   TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id <> b_id)
);
CREATE INDEX IF NOT EXISTS idx_investor_assoc_b ON investor_associations (b_id);

-- Forkastede leads: avvist men beholdt (ikke papirkurv). Skjules fra aktiv leads-liste
-- via discarded_at IS NULL; re-surfaces hvis de treffer i en ny import.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='discarded_at') THEN
    ALTER TABLE investors ADD COLUMN discarded_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='discarded_by') THEN
    ALTER TABLE investors ADD COLUMN discarded_by TEXT;
  END IF;
END $$;

-- Frie tekst-tags på investorer (JSONB-array av strenger)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='tags') THEN
    ALTER TABLE investors ADD COLUMN tags JSONB DEFAULT '[]';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_investors_tags ON investors USING GIN (tags);

-- Strukturert meta per liste-tag (f.eks. Kapital 400): list_meta["K400 2025"] =
-- {personer:[{rank,person,formue_mrd,bransje}]}. Én nøkkel per år → siste år trumfer,
-- eldre år ligger igjen som historikk. Tag styrer medlemskap/filter; dette er tallene.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='investors' AND column_name='list_meta') THEN
    ALTER TABLE investors ADD COLUMN list_meta JSONB DEFAULT '{}';
  END IF;
END $$;
