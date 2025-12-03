-- Migration number: 0002
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    license_key TEXT,
    player_uuid TEXT NOT NULL,
    player_name TEXT NOT NULL,
    system_username_hash TEXT,
    system_hardware_hash TEXT
);
