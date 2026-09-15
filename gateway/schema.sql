-- 兑换码网关 D1 表结构（幂等，可重复执行）
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  note TEXT DEFAULT '',
  max_devices INTEGER DEFAULT 3,
  revoked INTEGER DEFAULT 0,
  last_self_unbind_at INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  code TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT DEFAULT '',
  activated_at INTEGER,
  last_seen INTEGER,
  PRIMARY KEY (code, device_id)
);
