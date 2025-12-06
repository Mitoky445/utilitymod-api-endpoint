-- Migration number: 0003
CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT,
    player_uuid TEXT,
    player_name TEXT,
    system_username_hash TEXT,
    system_hardware_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
