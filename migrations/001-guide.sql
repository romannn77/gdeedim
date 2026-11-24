CREATE TABLE IF NOT EXISTS venues (
 id text PRIMARY KEY, name text NOT NULL, type text NOT NULL CHECK(type IN ('restaurant','cafe','coffee')),
 lat double precision NOT NULL, lon double precision NOT NULL, address text, hours text,
 source_url text, verified_at text, visibility text NOT NULL DEFAULT 'visible', review text,
 duplicate_of text REFERENCES venues(id), capacity integer CHECK(capacity>0), counter_hash text UNIQUE,
 people integer, measured_at bigint, status text CHECK(status IN ('free','few','full')), updated_at bigint, party integer
);
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, email text UNIQUE NOT NULL, password text NOT NULL,
 role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','partner','admin')), venue_id text REFERENCES venues(id)
);
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS favorites(user_id text REFERENCES users(id),venue_id text REFERENCES venues(id),PRIMARY KEY(user_id,venue_id));
CREATE TABLE IF NOT EXISTS applications(user_id text PRIMARY KEY REFERENCES users(id),venue_id text REFERENCES venues(id),created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS offers (
 id text PRIMARY KEY, venue_id text REFERENCES venues(id) NOT NULL,title text NOT NULL,terms text NOT NULL,code text NOT NULL,
 starts bigint NOT NULL,ends bigint NOT NULL,max_uses integer NOT NULL CHECK(max_uses>0),state text NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS redemptions(offer_id text REFERENCES offers(id),user_id text REFERENCES users(id),at bigint NOT NULL,PRIMARY KEY(offer_id,user_id));
CREATE TABLE IF NOT EXISTS imports(id bigserial PRIMARY KEY,at bigint NOT NULL,source text NOT NULL,count integer NOT NULL,boundary text,verified text);
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,at bigint NOT NULL,actor text NOT NULL,action text NOT NULL,target text);
CREATE TABLE IF NOT EXISTS attempts(key text PRIMARY KEY,since bigint NOT NULL,n integer NOT NULL);
