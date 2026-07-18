CREATE TYPE user_role AS ENUM ('CUSTOMER', 'ADMIN');
CREATE TYPE broadcast_status AS ENUM ('PLACED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, company_name TEXT, phone TEXT, role user_role NOT NULL DEFAULT 'CUSTOMER', is_active BOOLEAN NOT NULL DEFAULT TRUE, email_verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE broadcasts (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), reference_no TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, audio_key TEXT NOT NULL, contacts_key TEXT NOT NULL, contact_count INTEGER, scheduled_for TIMESTAMPTZ, status broadcast_status NOT NULL DEFAULT 'PLACED', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX broadcasts_owner_status_idx ON broadcasts(user_id, status, created_at DESC);
CREATE TABLE reports (id UUID PRIMARY KEY, broadcast_id UUID UNIQUE NOT NULL REFERENCES broadcasts(id), file_key TEXT NOT NULL, metrics JSONB NOT NULL DEFAULT '{}', customer_remarks TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE support_tickets (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), reference_no TEXT UNIQUE NOT NULL, subject TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL', status ticket_status NOT NULL DEFAULT 'OPEN', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE support_messages (id UUID PRIMARY KEY, ticket_id UUID NOT NULL REFERENCES support_tickets(id), sender_id UUID NOT NULL REFERENCES users(id), body TEXT NOT NULL, attachment_key TEXT, is_internal BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE activity_logs (id UUID PRIMARY KEY, actor_id UUID REFERENCES users(id), entity_type TEXT NOT NULL, entity_id UUID, action TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX activity_logs_entity_idx ON activity_logs(entity_type, entity_id, created_at DESC);
