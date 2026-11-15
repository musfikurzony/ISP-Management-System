-- ISP Billing: initial database structure.
-- Money is stored as whole numbers in PAISA (1 Taka = 100 paisa) so that
-- totals never suffer from decimal rounding errors.
-- Dates are stored as text: YYYY-MM-DD (Asia/Dhaka calendar date).
-- Timestamps are stored as UTC text: YYYY-MM-DD HH:MM:SS.

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name       TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Login sessions. Only a SHA-256 hash of the session token is stored.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE packages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  download_mbps REAL NOT NULL CHECK (download_mbps > 0),
  upload_mbps   REAL NOT NULL CHECK (upload_mbps > 0),
  price         INTEGER NOT NULL CHECK (price >= 0),
  description   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code   TEXT UNIQUE,
  name            TEXT NOT NULL,
  mobile          TEXT NOT NULL,
  address         TEXT,
  area            TEXT,
  connection_date TEXT NOT NULL,
  package_id      INTEGER REFERENCES packages(id) ON DELETE RESTRICT,
  monthly_bill    INTEGER NOT NULL CHECK (monthly_bill >= 0),
  connection_type TEXT NOT NULL DEFAULT 'pppoe' CHECK (connection_type IN ('pppoe', 'static', 'other')),
  username        TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_area ON customers(area);
CREATE INDEX idx_customers_mobile ON customers(mobile);
CREATE INDEX idx_customers_name ON customers(name COLLATE NOCASE);
CREATE INDEX idx_customers_package ON customers(package_id);

-- History of which package / price a customer had and when.
CREATE TABLE subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  package_id    INTEGER REFERENCES packages(id) ON DELETE RESTRICT,
  monthly_price INTEGER NOT NULL CHECK (monthly_price >= 0),
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subscriptions_customer ON subscriptions(customer_id);

CREATE TABLE invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no     TEXT UNIQUE,
  customer_id    INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('monthly', 'manual')),
  billing_period TEXT,                         -- YYYY-MM (required for monthly bills)
  issue_date     TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  total          INTEGER NOT NULL CHECK (total >= 0),
  paid_amount    INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status         TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid', 'void')),
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id), -- empty = created automatically
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  void_reason    TEXT,
  voided_by      INTEGER REFERENCES users(id),
  voided_at      TEXT,
  CHECK (kind <> 'monthly' OR billing_period IS NOT NULL)
);
-- The rule that makes duplicate monthly bills impossible:
-- one live monthly invoice per customer per billing period.
CREATE UNIQUE INDEX idx_invoices_one_monthly_per_period
  ON invoices(customer_id, billing_period)
  WHERE kind = 'monthly' AND status <> 'void';
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_period ON invoices(billing_period);
CREATE INDEX idx_invoices_issue_date ON invoices(issue_date);

-- Line items keep their own copy of description and price, so an old invoice
-- never changes when a package price is edited later.
CREATE TABLE invoice_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  INTEGER NOT NULL CHECK (unit_price >= 0),
  amount      INTEGER NOT NULL CHECK (amount >= 0)
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);

-- Payments are never deleted. A wrong payment is "reversed" and stays visible.
CREATE TABLE payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no      TEXT UNIQUE,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  method          TEXT NOT NULL CHECK (method IN ('cash', 'bkash', 'nagad', 'rocket', 'bank', 'other')),
  reference       TEXT,                        -- transaction ID / cheque no.
  payment_date    TEXT NOT NULL,
  verified        INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  verified_by     INTEGER REFERENCES users(id),
  verified_at     TEXT,
  notes           TEXT,
  collected_by    INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'reversed')),
  reversal_reason TEXT,
  reversed_by     INTEGER REFERENCES users(id),
  reversed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_payments_collector ON payments(collected_by);
CREATE INDEX idx_payments_status ON payments(status);

-- Which payment paid which invoice. Money not allocated to any invoice
-- is the customer's advance balance.
CREATE TABLE payment_allocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  released_at TEXT                             -- set when the invoice is voided
);
CREATE INDEX idx_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX idx_allocations_invoice ON payment_allocations(invoice_id);

CREATE TABLE expenses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  expense_date    TEXT NOT NULL,
  description     TEXT,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'reversed')),
  reversal_reason TEXT,
  reversed_by     INTEGER REFERENCES users(id),
  reversed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);

-- Income other than customer bill payments (e.g. connection fees, router sales).
CREATE TABLE income (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  income_date     TEXT NOT NULL,
  description     TEXT,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'reversed')),
  reversal_reason TEXT,
  reversed_by     INTEGER REFERENCES users(id),
  reversed_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_income_date ON income(income_date);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- Safety nets: the database itself refuses to delete money records
-- or to change the amount of an existing one.
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'Payments cannot be deleted. Reverse the payment instead.'); END;

CREATE TRIGGER trg_payments_amount_locked BEFORE UPDATE OF amount, customer_id ON payments
BEGIN SELECT RAISE(ABORT, 'A payment amount cannot be changed. Reverse it and record a new one.'); END;

CREATE TRIGGER trg_invoices_no_delete BEFORE DELETE ON invoices
BEGIN SELECT RAISE(ABORT, 'Invoices cannot be deleted. Void the invoice instead.'); END;

CREATE TRIGGER trg_invoices_total_locked BEFORE UPDATE OF total, customer_id ON invoices
BEGIN SELECT RAISE(ABORT, 'An invoice amount cannot be changed. Void it and create a new one.'); END;

CREATE TRIGGER trg_expenses_no_delete BEFORE DELETE ON expenses
BEGIN SELECT RAISE(ABORT, 'Expenses cannot be deleted. Reverse the entry instead.'); END;

CREATE TRIGGER trg_income_no_delete BEFORE DELETE ON income
BEGIN SELECT RAISE(ABORT, 'Income cannot be deleted. Reverse the entry instead.'); END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Audit history cannot be deleted.'); END;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Audit history cannot be changed.'); END;
