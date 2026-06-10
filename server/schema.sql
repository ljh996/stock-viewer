-- stock-viewer 用户数据持久化 Schema
-- 数据库: stock (MySQL 8.4)

-- 用户表（基于 device_id 匿名标识 + JWT 登录）
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE DEFAULT NULL COMMENT '登录用户名（JWT 阶段新增）',
  password_hash VARCHAR(255) DEFAULT NULL COMMENT 'bcrypt 密码哈希（JWT 阶段新增）',
  role ENUM('admin', 'user') DEFAULT 'user' COMMENT '角色（JWT 阶段新增）',
  device_id VARCHAR(64) NOT NULL UNIQUE,
  last_login DATETIME DEFAULT NULL COMMENT '最后登录时间',
  avatar_url VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_device_id (device_id),
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 自选股列表
CREATE TABLE IF NOT EXISTS watchlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  name VARCHAR(100) DEFAULT '',
  market ENUM('CN', 'US') DEFAULT 'CN',
  sort_order INT DEFAULT 0,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_symbol (user_id, symbol),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 自定义热门股
CREATE TABLE IF NOT EXISTS custom_picks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  name VARCHAR(100) DEFAULT '',
  market ENUM('CN', 'US') DEFAULT 'CN',
  sort_order INT DEFAULT 0,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_symbol_market (user_id, symbol, market),
  INDEX idx_user_id_market (user_id, market)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 持仓记录（仓位管理）
CREATE TABLE IF NOT EXISTS portfolios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  current_mode ENUM('empty', 'light', 'heavy', 'short') DEFAULT 'empty',
  year_stock_count INT DEFAULT 0,
  month_trade_count INT DEFAULT 0,
  current_holding INT DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_mode (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 操作记录（仓位管理的买入卖出动作）
CREATE TABLE IF NOT EXISTS portfolio_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('buy', 'sell') NOT NULL,
  symbol VARCHAR(10) NOT NULL,
  action_date VARCHAR(10) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_actions (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 回测记录
CREATE TABLE IF NOT EXISTS backtest_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  strategy VARCHAR(30) NOT NULL,
  initial_capital DECIMAL(12,2) NOT NULL,
  period INT NOT NULL,
  total_return DECIMAL(8,2) DEFAULT 0,
  annual_return DECIMAL(8,2) DEFAULT 0,
  max_drawdown DECIMAL(8,2) DEFAULT 0,
  sharpe DECIMAL(6,2) DEFAULT 0,
  result_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_backtests (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户偏好
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INT NOT NULL PRIMARY KEY,
  theme ENUM('light', 'dark') DEFAULT 'light',
  default_market ENUM('CN', 'US') DEFAULT 'CN',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- === JWT 用户系统迁移（2026-06-08）===
-- 如果已有 users 表但缺少新字段，运行以下 ALTER：
-- ALTER TABLE users ADD COLUMN username VARCHAR(50) UNIQUE DEFAULT NULL AFTER id;
-- ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL AFTER username;
-- ALTER TABLE users ADD COLUMN role ENUM('admin', 'user') DEFAULT 'user' AFTER password_hash;
-- ALTER TABLE users ADD COLUMN last_login DATETIME DEFAULT NULL AFTER device_id;
-- ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) DEFAULT NULL AFTER last_login;
-- CREATE INDEX idx_username ON users(username);

-- === Python 微服务数据表（2026-06-10）===
-- 用于替换 Python api.py 中的 SQLite，与 Express 共享 MySQL

CREATE TABLE IF NOT EXISTS stock_quote (
  symbol VARCHAR(10) PRIMARY KEY,
  name VARCHAR(50) DEFAULT '',
  price DECIMAL(10,2) DEFAULT 0,
  change_percent DECIMAL(6,2) DEFAULT 0,
  pe DECIMAL(10,2) DEFAULT 0,
  pb DECIMAL(10,2) DEFAULT 0,
  market_cap DECIMAL(20,2) DEFAULT 0,
  turnover_rate DECIMAL(6,2) DEFAULT 0,
  update_time DATETIME DEFAULT NULL,
  INDEX idx_quote_mktcap (market_cap),
  INDEX idx_quote_pe (pe)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_data (
  symbol VARCHAR(10) PRIMARY KEY,
  revenue DECIMAL(20,2) DEFAULT 0,
  cost DECIMAL(20,2) DEFAULT 0,
  net_profit DECIMAL(20,2) DEFAULT 0,
  prev_net_profit DECIMAL(20,2) DEFAULT 0,
  gp_margin DECIMAL(6,2) DEFAULT 0,
  np_growth DECIMAL(6,2) DEFAULT 0,
  update_time DATETIME DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS limit_up_pool (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date VARCHAR(8) DEFAULT NULL,
  symbol VARCHAR(10) DEFAULT NULL,
  name VARCHAR(50) DEFAULT '',
  price DECIMAL(10,2) DEFAULT 0,
  change_percent DECIMAL(6,2) DEFAULT 0,
  turnover_rate DECIMAL(6,2) DEFAULT 0,
  limit_up_count INT DEFAULT 1,
  seal_amount DECIMAL(20,2) DEFAULT 0,
  first_limit_time VARCHAR(10) DEFAULT '',
  industry VARCHAR(30) DEFAULT '',
  UNIQUE KEY uk_date_symbol (date, symbol),
  INDEX idx_limit_up_date (date),
  INDEX idx_limit_up_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS limit_up_stats (
  date VARCHAR(8) PRIMARY KEY,
  total_count INT DEFAULT 0,
  industry_stats JSON DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
