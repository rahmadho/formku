/**
 * schema.ts — DDL lengkap FormKu (schema `formku`). Idempoten (IF NOT EXISTS).
 * Sumber kebenaran skema: docs/KONTRAK-TEKNIS.md §2.
 */
export const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS formku;

CREATE TABLE IF NOT EXISTS formku.tenants (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_email TEXT,
  api_key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formku.forms (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES formku.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  mode TEXT NOT NULL DEFAULT 'form',
  status TEXT NOT NULL DEFAULT 'draft',
  timer_seconds INT,
  timer_scope TEXT DEFAULT 'form',
  shuffle_questions BOOLEAN NOT NULL DEFAULT false,
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  bank_pick_count INT,
  passing_grade INT,
  show_score BOOLEAN NOT NULL DEFAULT true,
  require_token BOOLEAN NOT NULL DEFAULT false,
  access_token TEXT,
  theme_json JSONB,
  thanks_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formku.sections (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES formku.forms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort INT NOT NULL DEFAULT 0,
  timer_seconds INT
);

CREATE TABLE IF NOT EXISTS formku.questions (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES formku.forms(id) ON DELETE CASCADE,
  section_id INT REFERENCES formku.sections(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  help_text TEXT,
  required BOOLEAN NOT NULL DEFAULT false,
  points INT NOT NULL DEFAULT 0,
  correct_json JSONB,
  settings_json JSONB,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS formku.conditions (
  id SERIAL PRIMARY KEY,
  question_id INT NOT NULL REFERENCES formku.questions(id) ON DELETE CASCADE,
  depends_on_question_id INT NOT NULL REFERENCES formku.questions(id) ON DELETE CASCADE,
  operator TEXT NOT NULL,
  compare_value TEXT,
  action TEXT NOT NULL DEFAULT 'show'
);

CREATE TABLE IF NOT EXISTS formku.responses (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES formku.forms(id) ON DELETE CASCADE,
  respondent_name TEXT,
  respondent_email TEXT,
  token_used TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  duration_seconds INT,
  score INT,
  max_score INT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  ip TEXT
);

CREATE TABLE IF NOT EXISTS formku.answers (
  id SERIAL PRIMARY KEY,
  response_id INT NOT NULL REFERENCES formku.responses(id) ON DELETE CASCADE,
  question_id INT NOT NULL REFERENCES formku.questions(id) ON DELETE CASCADE,
  value_json JSONB,
  is_correct BOOLEAN,
  points_awarded INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS formku.bank_questions (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES formku.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  options_json JSONB,
  correct_json JSONB,
  points INT NOT NULL DEFAULT 1,
  tags TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formku.audit_events (
  id SERIAL PRIMARY KEY,
  response_id INT NOT NULL REFERENCES formku.responses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forms_tenant ON formku.forms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_questions_form ON formku.questions(form_id);
CREATE INDEX IF NOT EXISTS idx_sections_form ON formku.sections(form_id);
CREATE INDEX IF NOT EXISTS idx_responses_form ON formku.responses(form_id);
CREATE INDEX IF NOT EXISTS idx_answers_response ON formku.answers(response_id);
CREATE INDEX IF NOT EXISTS idx_bank_tenant ON formku.bank_questions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_response ON formku.audit_events(response_id);
`;
