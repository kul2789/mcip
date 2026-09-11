CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  courier_partner VARCHAR(32) NOT NULL,
  courier_shipment_id VARCHAR(128) NULL,
  awb_number VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  request_payload JSON NOT NULL,
  response_payload JSON NULL,
  failure_reason VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_orders_order_id (order_id)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  description VARCHAR(512) NULL,
  location VARCHAR(255) NULL,
  raw_payload JSON NOT NULL,
  recorded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tracking_order_id (order_id),
  CONSTRAINT fk_tracking_order
    FOREIGN KEY (order_id) REFERENCES orders (order_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bulk_jobs (
  batch_id CHAR(36) NOT NULL PRIMARY KEY,
  status VARCHAR(32) NOT NULL,
  total INT NOT NULL,
  succeeded INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  results JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);
