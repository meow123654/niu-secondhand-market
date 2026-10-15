CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price INTEGER NOT NULL,
  category TEXT NOT NULL,
  condition TEXT NOT NULL,
  seller TEXT NOT NULL,
  contact TEXT NOT NULL,
  location TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  emoji TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',
  createdAt INTEGER NOT NULL,
  department TEXT DEFAULT '',
  ownerId TEXT DEFAULT '',
  mediaType TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_department TEXT DEFAULT '',
  body TEXT DEFAULT '',
  media_url TEXT DEFAULT '',
  media_type TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_by_product_time ON messages(product_id, created_at);
