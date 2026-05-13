# -*- coding: utf-8 -*-
"""
A股行情微服务 - SQLite 缓存 + AKShare 数据源
数据源：
1. 新浪 Market_Center.getHQNodeData → 全A股实时行情
2. AKShare stock_zt_pool_em → 涨停池
3. AKShare stock_financial_report_sina → 利润表（营业收入、营业成本、净利润）
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import sqlite3
import os
import time
import json
import threading
import urllib.request
from datetime import datetime, timedelta

import akshare as ak

app = Flask(__name__)
CORS(app)

# ==================== 配置 ====================

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stock_cache.db')
MAX_PAGES = 30
PAGE_SIZE = 80
MAX_RESULTS = 30

# 同步状态
_sync_status = {
    'quotes': False,
    'limit_up': False,
    'financial': False,
    'last_quotes_sync': None,
    'last_limit_up_sync': None,
    'last_financial_sync': None,
    'quotes_count': 0,
    'limit_up_count': 0,
    'financial_count': 0,
    'syncing': False,
    'message': '等待同步...',
}
_sync_lock = threading.Lock()

# ==================== 辅助函数 ====================


def safe_float(val, default=0.0):
    """安全转换为 float"""
    try:
        if val is None or str(val).strip() in ('None', '-', '', 'nan', 'NaN', '--'):
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


def get_db():
    """获取数据库连接"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def http_get(url, timeout=15, encoding='utf-8', headers=None):
    """通用 HTTP GET 请求"""
    try:
        default_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        if headers:
            default_headers.update(headers)
        req = urllib.request.Request(url, headers=default_headers)
        resp = urllib.request.urlopen(req, timeout=timeout)
        raw = resp.read()
        return raw.decode(encoding, errors='ignore')
    except Exception as e:
        print(f'[http] request failed: {e}')
        return None


def update_sync_status(**kwargs):
    """更新同步状态"""
    try:
        with _sync_lock:
            _sync_status.update(kwargs)
    except Exception:
        pass


# ==================== SQLite 初始化 ====================


def init_db():
    """初始化数据库"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        # 全A股行情表（每日更新）
        c.execute('''CREATE TABLE IF NOT EXISTS stock_quote (
            symbol TEXT PRIMARY KEY,
            name TEXT,
            price REAL,
            change_percent REAL,
            pe REAL,
            pb REAL,
            market_cap REAL,
            turnover_rate REAL,
            update_time TEXT
        )''')

        # 财务数据表（季度更新）
        c.execute('''CREATE TABLE IF NOT EXISTS financial_data (
            symbol TEXT PRIMARY KEY,
            revenue REAL,
            cost REAL,
            net_profit REAL,
            prev_net_profit REAL,
            gp_margin REAL,
            np_growth REAL,
            update_time TEXT
        )''')

        # 涨停池表（每日更新）
        c.execute('''CREATE TABLE IF NOT EXISTS limit_up_pool (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            symbol TEXT,
            name TEXT,
            price REAL,
            change_percent REAL,
            turnover_rate REAL,
            limit_up_count INTEGER,
            seal_amount REAL,
            first_limit_time TEXT,
            industry TEXT,
            UNIQUE(date, symbol)
        )''')

        # 涨停统计表（板块统计）
        c.execute('''CREATE TABLE IF NOT EXISTS limit_up_stats (
            date TEXT PRIMARY KEY,
            total_count INTEGER,
            industry_stats TEXT
        )''')

        # 创建索引加速查询
        c.execute('CREATE INDEX IF NOT EXISTS idx_limit_up_date ON limit_up_pool(date)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_limit_up_symbol ON limit_up_pool(symbol)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_quote_mktcap ON stock_quote(market_cap)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_quote_pe ON stock_quote(pe)')

        conn.commit()
        conn.close()
        print('[db] 数据库初始化完成')
    except Exception as e:
        print(f'[db] 初始化失败: {e}')


# ==================== 数据同步逻辑 ====================


def sync_all_quotes():
    """同步全A股行情到SQLite"""
    try:
        update_sync_status(syncing=True, message='正在同步全A股行情...')
        stocks = []
        for page in range(1, MAX_PAGES + 1):
            try:
                url = (
                    'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/'
                    'Market_Center.getHQNodeData?page=%d&num=%d&sort=mktcap&asc=0'
                    '&node=hs_a&symbol=&_s_r_a=page' % (page, PAGE_SIZE)
                )
                text = http_get(url, timeout=10, encoding='gbk', headers={
                    'Referer': 'https://finance.sina.com.cn',
                })
                if not text:
                    break
                data = json.loads(text)
                if not isinstance(data, list) or len(data) == 0:
                    break
                stocks.extend(data)
            except Exception:
                break

        if not stocks:
            print('[sync] 未获取到行情数据')
            update_sync_status(syncing=False, message='行情同步失败：未获取到数据')
            return

        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        conn = sqlite3.connect(DB_PATH)
        count = 0
        for s in stocks:
            try:
                price = safe_float(s.get('trade'))
                if price <= 0:
                    continue
                symbol = str(s.get('code', '')).strip()
                name = str(s.get('name', '')).strip()
                change_percent = safe_float(s.get('changepercent'))
                pe = safe_float(s.get('per'))
                pb = safe_float(s.get('pb'))
                market_cap = safe_float(s.get('mktcap'))
                turnover_rate = safe_float(s.get('turnoverratio'))
                conn.execute(
                    'INSERT OR REPLACE INTO stock_quote '
                    '(symbol, name, price, change_percent, pe, pb, market_cap, turnover_rate, update_time) '
                    'VALUES (?,?,?,?,?,?,?,?,?)',
                    (symbol, name, price, change_percent, pe, pb, market_cap, turnover_rate, now)
                )
                count += 1
            except Exception:
                continue
        conn.commit()
        conn.close()

        update_sync_status(
            quotes=True,
            last_quotes_sync=now,
            quotes_count=count,
            message=f'行情同步完成，共 {count} 只股票',
        )
        print(f'[sync] 行情同步完成，共 {count} 只股票')
    except Exception as e:
        print(f'[sync] 行情同步失败: {e}')
        update_sync_status(syncing=False, message=f'行情同步失败: {e}')


def sync_limit_up(date_str):
    """同步某日涨停池到SQLite"""
    try:
        df = ak.stock_zt_pool_em(date=date_str)
        if df is None or df.empty:
            print(f'[sync] 涨停池 {date_str} 无数据')
            return 0

        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        conn = sqlite3.connect(DB_PATH)
        count = 0
        for _, row in df.iterrows():
            try:
                symbol = str(row.get('代码', '')).strip()
                name = str(row.get('名称', '')).strip()
                price = safe_float(row.get('最新价'))
                change_percent = safe_float(row.get('涨跌幅'))
                turnover_rate = safe_float(row.get('换手率'))
                limit_up_count = int(safe_float(row.get('连板数'), 1))
                seal_amount = safe_float(row.get('封板资金'))
                first_limit_time = str(row.get('首次封板时间', '')).strip()
                industry = str(row.get('所属行业', '')).strip()

                conn.execute(
                    'INSERT OR REPLACE INTO limit_up_pool '
                    '(date, symbol, name, price, change_percent, turnover_rate, '
                    'limit_up_count, seal_amount, first_limit_time, industry) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (date_str, symbol, name, price, change_percent, turnover_rate,
                     limit_up_count, seal_amount, first_limit_time, industry)
                )
                count += 1
            except Exception:
                continue
        conn.commit()

        # 更新板块统计
        rows = conn.execute(
            'SELECT industry, COUNT(*) as cnt, AVG(change_percent) as avg_change, '
            'SUM(seal_amount) as total_seal '
            'FROM limit_up_pool WHERE date = ? GROUP BY industry ORDER BY cnt DESC',
            (date_str,)
        ).fetchall()
        industry_stats = json.dumps(
            [{'industry': r[0], 'count': r[1], 'avg_change': round(r[2], 2), 'total_seal': r[3]}
             for r in rows if r[0]],
            ensure_ascii=False
        )
        conn.execute(
            'INSERT OR REPLACE INTO limit_up_stats (date, total_count, industry_stats) VALUES (?,?,?)',
            (date_str, count, industry_stats)
        )
        conn.commit()
        conn.close()

        print(f'[sync] 涨停池 {date_str} 同步完成，共 {count} 条')
        return count
    except Exception as e:
        print(f'[sync] 涨停池 {date_str} 同步失败: {e}')
        return 0


def sync_financial_batch(symbols):
    """批量同步财务数据（只查利润表）"""
    try:
        update_sync_status(message=f'正在同步财务数据 (0/{len(symbols)})...')
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        conn = sqlite3.connect(DB_PATH)
        count = 0
        total = len(symbols)

        for i, code in enumerate(symbols):
            try:
                stock_code = 'sh' + code if code.startswith('6') else 'sz' + code
                df = ak.stock_financial_report_sina(stock=stock_code, symbol='利润表')
                if df is None or df.empty:
                    continue

                latest = df.iloc[0]
                prev = df.iloc[1] if len(df) > 1 else latest

                revenue = safe_float(latest.get('营业收入', 0))
                cost = safe_float(latest.get('营业成本', 0))
                net_profit = safe_float(latest.get('净利润', 0))
                prev_net_profit = safe_float(prev.get('净利润', 0))

                gp_margin = (revenue - cost) / revenue * 100 if revenue > 0 else 0
                np_growth = (net_profit - prev_net_profit) / abs(prev_net_profit) * 100 \
                    if prev_net_profit != 0 else 0

                conn.execute(
                    'INSERT OR REPLACE INTO financial_data '
                    '(symbol, revenue, cost, net_profit, prev_net_profit, gp_margin, np_growth, update_time) '
                    'VALUES (?,?,?,?,?,?,?)',
                    (code, revenue, cost, net_profit, prev_net_profit, gp_margin, np_growth, now)
                )
                count += 1

                if (i + 1) % 50 == 0:
                    update_sync_status(message=f'正在同步财务数据 ({i + 1}/{total})...')
                    print(f'[sync] 财务数据进度: {i + 1}/{total}')
            except Exception:
                continue

        conn.commit()
        conn.close()

        update_sync_status(
            financial=True,
            last_financial_sync=now,
            financial_count=count,
            message=f'财务数据同步完成，共 {count} 只股票',
        )
        print(f'[sync] 财务数据同步完成，共 {count} 只股票')
    except Exception as e:
        print(f'[sync] 财务数据同步失败: {e}')
        update_sync_status(message=f'财务数据同步失败: {e}')


# ==================== 后台同步 ====================


def background_sync():
    """后台线程：启动时同步数据"""
    try:
        time.sleep(2)  # 等Flask启动

        # 1. 同步全A股行情
        print('[sync] 开始同步全A股行情...')
        sync_all_quotes()

        # 2. 同步最近5天涨停池
        today = datetime.now()
        total_limit_up = 0
        for i in range(6):
            try:
                d = today - timedelta(days=i)
                if d.weekday() >= 5:  # 跳过周末
                    continue
                ds = d.strftime('%Y%m%d')
                print(f'[sync] 同步涨停池 {ds}...')
                cnt = sync_limit_up(ds)
                total_limit_up += cnt
            except Exception:
                continue

        update_sync_status(limit_up=True, last_limit_up_sync=datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                           limit_up_count=total_limit_up)

        # 3. 同步前200只股票的财务数据（按市值排序）
        try:
            conn = sqlite3.connect(DB_PATH)
            rows = conn.execute(
                'SELECT symbol FROM stock_quote ORDER BY market_cap DESC LIMIT 200'
            ).fetchall()
            conn.close()
            symbols = [r[0] for r in rows]
            if symbols:
                print(f'[sync] 同步 {len(symbols)} 只股票财务数据...')
                sync_financial_batch(symbols)
        except Exception as e:
            print(f'[sync] 获取市值排序股票失败: {e}')

        update_sync_status(syncing=False, message='初始同步全部完成')
        print('[sync] 初始同步全部完成')
    except Exception as e:
        print(f'[sync] 后台同步异常: {e}')
        update_sync_status(syncing=False, message=f'同步异常: {e}')


# ==================== 涨停质量评分 ====================


def calc_limit_up_score(row):
    """计算涨停质量评分（0-100）"""
    try:
        score = 0

        # 1. 封板时间（越早越好，满分30）
        first_time = str(row.get('first_limit_time', ''))
        if first_time and ':' in first_time:
            try:
                parts = first_time.split(':')
                h, m = int(parts[0]), int(parts[1])
                minutes = h * 60 + m - 9 * 60 - 30  # 9:30开盘
                if minutes <= 5:
                    score += 30
                elif minutes <= 15:
                    score += 25
                elif minutes <= 30:
                    score += 20
                elif minutes <= 60:
                    score += 15
                else:
                    score += 10
            except Exception:
                score += 10
        else:
            score += 10

        # 2. 封单金额（满分30）
        seal = safe_float(row.get('seal_amount', 0))
        if seal > 500000000:
            score += 30
        elif seal > 200000000:
            score += 25
        elif seal > 100000000:
            score += 20
        elif seal > 50000000:
            score += 15
        else:
            score += 10

        # 3. 换手率（适中最好，满分20）
        turnover = safe_float(row.get('turnover_rate', 0))
        if 5 <= turnover <= 20:
            score += 20
        elif 3 <= turnover <= 25:
            score += 15
        elif 1 <= turnover <= 30:
            score += 10
        else:
            score += 5

        # 4. 连板数（越多越好，满分20）
        boards = int(safe_float(row.get('limit_up_count', 1)))
        if boards >= 5:
            score += 20
        elif boards >= 3:
            score += 15
        elif boards >= 2:
            score += 12
        else:
            score += 8

        return score
    except Exception:
        return 50


# ==================== 板块统计 ====================


def get_industry_stats(date_str):
    """获取某日涨停板块统计"""
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT industry, COUNT(*) as cnt, '
            'AVG(change_percent) as avg_change, '
            'SUM(seal_amount) as total_seal '
            'FROM limit_up_pool '
            'WHERE date = ? '
            'GROUP BY industry '
            'ORDER BY cnt DESC',
            (date_str,)
        ).fetchall()
        conn.close()
        return [
            {
                'industry': r['industry'],
                'count': r['cnt'],
                'avg_change': round(r['avg_change'], 2) if r['avg_change'] else 0,
                'total_seal': r['total_seal'] or 0,
            }
            for r in rows if r['industry']
        ]
    except Exception as e:
        print(f'[stats] 获取板块统计失败: {e}')
        return []


# ==================== 策略实现（全部走SQLite） ====================


def build_strategy_result(row, extra_fields=None):
    """构建统一的策略结果字典"""
    try:
        result = {
            'symbol': row['symbol'],
            'name': row['name'],
            'price': round(safe_float(row['price']), 2),
            'change_percent': round(safe_float(row['change_percent']), 2),
            'pe': round(safe_float(row['pe']), 2),
            'pb': round(safe_float(row['pb']), 2),
            'market_cap': safe_float(row['market_cap']),
            'turnover_rate': round(safe_float(row['turnover_rate']), 2),
            'roe': round(safe_float(row.get('roe', 0)), 2),
            'np_growth': round(safe_float(row.get('np_growth', 0)), 2),
            'gp_margin': round(safe_float(row.get('gp_margin', 0)), 2),
            'score': round(safe_float(row.get('score', 0)), 2),
        }
        if extra_fields:
            result.update(extra_fields)
        return result
    except Exception:
        return None


def strategy_conservative():
    """保守型策略（纯行情数据）
    条件: PE>0 且 PE<15, PB>0 且 PB<3, 市值>200亿
    评分：PE低(35) + PB低(30) + 市值大(35)
    """
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT * FROM stock_quote '
            'WHERE pe > 0 AND pe < 15 AND pb > 0 AND pb < 3 AND market_cap > 200000 '
            'ORDER BY pe ASC, market_cap DESC '
            'LIMIT 100'
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                pe = safe_float(r['pe'])
                pb = safe_float(r['pb'])
                mktcap = safe_float(r['market_cap'])

                pe_score = max(0, (15 - pe) / 15) * 35
                pb_score = max(0, (3 - pb) / 3) * 30
                cap_score = min(mktcap / 10000000, 1) * 35
                score = pe_score + pb_score + cap_score

                d = dict(r)
                d['score'] = score
                d['roe'] = 0
                d['np_growth'] = 0
                d['gp_margin'] = 0

                result = build_strategy_result(d)
                if result:
                    results.append(result)
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:MAX_RESULTS]
    except Exception as e:
        print(f'[strategy] conservative error: {e}')
        return []


def strategy_garp():
    """GARP均衡策略（行情+财务）
    条件: PE>0 且 PE<80, 市值>50亿, 换手率>0.5%, 净利润增速>15%, 毛利率>30%
    评分：PEG低(40) + 净利润增速高(30) + 毛利率高(30)
    """
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT q.*, f.gp_margin, f.np_growth '
            'FROM stock_quote q '
            'LEFT JOIN financial_data f ON q.symbol = f.symbol '
            'WHERE q.pe > 0 AND q.pe < 80 AND q.market_cap > 50000 AND q.turnover_rate > 0.5 '
            'AND f.np_growth > 15 AND f.gp_margin > 30 '
            'ORDER BY (q.pe * 1.0 / MAX(f.np_growth, 1)) ASC '
            'LIMIT 100'
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                pe = safe_float(r['pe'])
                np_growth = safe_float(r['np_growth'])
                gp_margin = safe_float(r['gp_margin'])

                peg = pe / max(np_growth, 1)
                peg_score = max(0, (1.2 - peg) / 1.2) * 40 if peg < 1.2 else 0
                growth_score = min(np_growth / 100, 1) * 30
                margin_score = min(gp_margin / 80, 1) * 30
                score = peg_score + growth_score + margin_score

                d = dict(r)
                d['score'] = score
                d['roe'] = 0

                result = build_strategy_result(d)
                if result:
                    results.append(result)
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:MAX_RESULTS]
    except Exception as e:
        print(f'[strategy] garp error: {e}')
        return []


def strategy_momentum():
    """动量爆发策略（行情+财务）
    条件: 换手率>3%且<25%, 市值>50亿, 净利润增速>50%
    评分：净利润增速(50) + 换手率适中(50)
    """
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT q.*, f.np_growth, f.gp_margin '
            'FROM stock_quote q '
            'LEFT JOIN financial_data f ON q.symbol = f.symbol '
            'WHERE q.turnover_rate > 3 AND q.turnover_rate < 25 AND q.market_cap > 50000 '
            'AND f.np_growth > 50 '
            'ORDER BY f.np_growth DESC '
            'LIMIT 100'
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                np_growth = safe_float(r['np_growth'])
                turnover = safe_float(r['turnover_rate'])

                growth_score = min(np_growth / 200, 1) * 50
                if 8 <= turnover <= 12:
                    turnover_score = 50
                else:
                    dist = min(abs(turnover - 8), abs(turnover - 12))
                    turnover_score = max(0, 50 - dist * 5)
                score = growth_score + turnover_score

                d = dict(r)
                d['score'] = score
                d['roe'] = 0

                result = build_strategy_result(d)
                if result:
                    results.append(result)
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:MAX_RESULTS]
    except Exception as e:
        print(f'[strategy] momentum error: {e}')
        return []


def strategy_potential():
    """潜力型策略（行情+财务）
    条件: 市值>100亿, PE>0且PE<100, 换手率>1%, 净利润增速>50%
    评分：净利润增速(50) + 毛利率(30) + 市值(20)
    """
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT q.*, f.np_growth, f.gp_margin '
            'FROM stock_quote q '
            'LEFT JOIN financial_data f ON q.symbol = f.symbol '
            'WHERE q.market_cap > 100000 AND q.pe > 0 AND q.pe < 100 AND q.turnover_rate > 1 '
            'AND f.np_growth > 50 '
            'ORDER BY f.np_growth DESC, f.gp_margin DESC '
            'LIMIT 100'
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                np_growth = safe_float(r['np_growth'])
                gp_margin = safe_float(r['gp_margin'])
                mktcap = safe_float(r['market_cap'])

                growth_score = min(np_growth / 200, 1) * 50
                margin_score = min(gp_margin / 60, 1) * 30
                cap_score = min(mktcap / 10000000, 1) * 20
                score = growth_score + margin_score + cap_score

                d = dict(r)
                d['score'] = score
                d['roe'] = 0

                result = build_strategy_result(d)
                if result:
                    results.append(result)
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:MAX_RESULTS]
    except Exception as e:
        print(f'[strategy] potential error: {e}')
        return []


def strategy_limitback():
    """涨停回马枪：近期涨停过的股票，回调后再次放量
    条件: 最近7天有涨停, 今日涨幅<5%（回调中）, 换手率>2%, 市值>50亿
    评分：涨停天数(40) + 换手率(30) + 净利润增速(30)
    """
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT DISTINCT q.symbol, q.name, q.price, q.change_percent, q.pe, q.pb, '
            'q.market_cap, q.turnover_rate, f.np_growth, f.gp_margin, '
            'COUNT(DISTINCT l.date) as limit_days '
            'FROM stock_quote q '
            'JOIN limit_up_pool l ON q.symbol = l.symbol '
            'LEFT JOIN financial_data f ON q.symbol = f.symbol '
            'WHERE l.date >= date("now", "-7 days") '
            'AND q.change_percent < 5 '
            'AND q.turnover_rate > 2 '
            'AND q.market_cap > 50000 '
            'GROUP BY q.symbol '
            'ORDER BY limit_days DESC, q.turnover_rate DESC '
            'LIMIT 100'
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                limit_days = safe_float(r['limit_days'])
                turnover = safe_float(r['turnover_rate'])
                np_growth = safe_float(r['np_growth'])

                days_score = min(limit_days / 5, 1) * 40
                turnover_score = min(turnover / 15, 1) * 30
                growth_score = min(np_growth / 100, 1) * 30
                score = days_score + turnover_score + growth_score

                d = dict(r)
                d['score'] = score
                d['roe'] = 0

                result = build_strategy_result(d)
                if result:
                    results.append(result)
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:MAX_RESULTS]
    except Exception as e:
        print(f'[strategy] limitback error: {e}')
        return []


def strategy_ma_bullish():
    """均线多头排列：价格在多条均线上方（简化版：用涨跌幅趋势判断）
    条件: 涨跌幅>0, 换手率>1%, 市值>50亿, PE>0且PE<50
    评分：涨跌幅(40) + 换手率(30) + 市值(30)
    """
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT * FROM stock_quote '
            'WHERE change_percent > 0 AND turnover_rate > 1 AND market_cap > 50000 '
            'AND pe > 0 AND pe < 50 '
            'ORDER BY change_percent DESC '
            'LIMIT 100'
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                change = safe_float(r['change_percent'])
                turnover = safe_float(r['turnover_rate'])
                mktcap = safe_float(r['market_cap'])

                change_score = min(change / 10, 1) * 40
                turnover_score = min(turnover / 10, 1) * 30
                cap_score = min(mktcap / 5000000, 1) * 30
                score = change_score + turnover_score + cap_score

                d = dict(r)
                d['score'] = score
                d['roe'] = 0
                d['np_growth'] = 0
                d['gp_margin'] = 0

                result = build_strategy_result(d)
                if result:
                    results.append(result)
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:MAX_RESULTS]
    except Exception as e:
        print(f'[strategy] ma-bullish error: {e}')
        return []


# 策略映射
STRATEGY_MAP = {
    'conservative': strategy_conservative,
    'garp': strategy_garp,
    'momentum': strategy_momentum,
    'potential': strategy_potential,
    'limitback': strategy_limitback,
    'ma-bullish': strategy_ma_bullish,
}


# ==================== API 路由 ====================


@app.route('/api/health')
def health():
    """健康检查（显示同步状态）"""
    try:
        with _sync_lock:
            status = dict(_sync_status)
        return jsonify({
            'status': 'ok',
            'data_source': 'sina + akshare + sqlite',
            'timestamp': time.time(),
            'sync': status,
        })
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/api/sync/status')
def sync_status():
    """同步状态"""
    try:
        with _sync_lock:
            status = dict(_sync_status)
        return jsonify({
            'success': True,
            'sync': status,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sync/quotes', methods=['POST'])
def trigger_sync_quotes():
    """手动触发行情同步"""
    try:
        t = threading.Thread(target=sync_all_quotes, daemon=True)
        t.start()
        return jsonify({'success': True, 'message': '行情同步已触发'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sync/financial', methods=['POST'])
def trigger_sync_financial():
    """手动触发财务同步"""
    try:
        conn = get_db()
        rows = conn.execute(
            'SELECT symbol FROM stock_quote ORDER BY market_cap DESC LIMIT 200'
        ).fetchall()
        conn.close()
        symbols = [r['symbol'] for r in rows]
        if not symbols:
            return jsonify({'success': False, 'error': '无行情数据，请先同步行情'})

        t = threading.Thread(target=sync_financial_batch, args=(symbols,), daemon=True)
        t.start()
        return jsonify({'success': True, 'message': f'财务数据同步已触发，共 {len(symbols)} 只股票'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sync/limit-up', methods=['POST'])
def trigger_sync_limit_up():
    """手动触发涨停同步"""
    try:
        date_str = str(request.args.get('date', '')).strip()
        if not date_str:
            date_str = datetime.now().strftime('%Y%m%d')

        t = threading.Thread(target=sync_limit_up, args=(date_str,), daemon=True)
        t.start()
        return jsonify({'success': True, 'message': f'涨停池同步已触发: {date_str}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/limit-up/today')
def limit_up_today():
    """今日涨停（含质量评分）"""
    try:
        today = datetime.now().strftime('%Y%m%d')
        conn = get_db()
        rows = conn.execute(
            'SELECT * FROM limit_up_pool WHERE date = ? ORDER BY seal_amount DESC',
            (today,)
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                d = dict(r)
                d['score'] = calc_limit_up_score(d)
                results.append({
                    'symbol': d['symbol'],
                    'name': d['name'],
                    'price': round(safe_float(d['price']), 2),
                    'change_percent': round(safe_float(d['change_percent']), 2),
                    'turnover_rate': round(safe_float(d['turnover_rate']), 2),
                    'limit_up_count': int(safe_float(d['limit_up_count'], 1)),
                    'seal_amount': safe_float(d['seal_amount']),
                    'first_limit_time': d['first_limit_time'],
                    'industry': d['industry'],
                    'score': d['score'],
                })
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return jsonify({
            'success': True,
            'date': today,
            'count': len(results),
            'data': results,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/limit-up/history')
def limit_up_history():
    """历史涨停（含质量评分）"""
    try:
        date_str = str(request.args.get('date', '')).strip()
        if not date_str:
            return jsonify({'success': False, 'error': '缺少 date 参数'}), 400

        # 支持 YYYY-MM-DD 和 YYYYMMDD 格式
        date_clean = date_str.replace('-', '')
        if len(date_clean) != 8:
            return jsonify({'success': False, 'error': '日期格式应为 YYYY-MM-DD 或 YYYYMMDD'}), 400

        conn = get_db()
        rows = conn.execute(
            'SELECT * FROM limit_up_pool WHERE date = ? ORDER BY seal_amount DESC',
            (date_clean,)
        ).fetchall()
        conn.close()

        results = []
        for r in rows:
            try:
                d = dict(r)
                d['score'] = calc_limit_up_score(d)
                results.append({
                    'symbol': d['symbol'],
                    'name': d['name'],
                    'price': round(safe_float(d['price']), 2),
                    'change_percent': round(safe_float(d['change_percent']), 2),
                    'turnover_rate': round(safe_float(d['turnover_rate']), 2),
                    'limit_up_count': int(safe_float(d['limit_up_count'], 1)),
                    'seal_amount': safe_float(d['seal_amount']),
                    'first_limit_time': d['first_limit_time'],
                    'industry': d['industry'],
                    'score': d['score'],
                })
            except Exception:
                continue

        results.sort(key=lambda x: x['score'], reverse=True)
        return jsonify({
            'success': True,
            'date': date_clean,
            'count': len(results),
            'data': results,
            'message': '该日无数据（非交易日或数据不可用）' if not results else '',
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/limit-up/stats')
def limit_up_stats():
    """板块统计"""
    try:
        date_str = str(request.args.get('date', '')).strip()
        if not date_str:
            date_str = datetime.now().strftime('%Y%m%d')
        else:
            date_str = date_str.replace('-', '')

        stats = get_industry_stats(date_str)
        return jsonify({
            'success': True,
            'date': date_str,
            'count': len(stats),
            'data': stats,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/strategy/<name>')
def get_strategy(name):
    """策略选股接口"""
    try:
        strategy_fn = STRATEGY_MAP.get(name)
        if not strategy_fn:
            return jsonify({'success': False, 'error': '未知策略: %s' % name}), 400

        t0 = time.time()
        results = strategy_fn()
        elapsed = round(time.time() - t0, 3)

        return jsonify({
            'success': True,
            'strategy': name,
            'count': len(results),
            'data': results,
            'elapsed': elapsed,
            'message': '',
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/backtest', methods=['POST'])
def run_backtest():
    """
    回测接口
    参数：
    - strategy: 策略名称 (conservative/garp/momentum/potential/limitback/ma-bullish)
    - initial_capital: 初始资金（默认 1000000）
    - period: 回测天数（默认 30）
    """
    try:
        import math
        import random

        data = request.get_json(silent=True) or {}
        strategy = str(data.get('strategy', 'conservative')).strip().lower()
        initial_capital = safe_float(data.get('initial_capital', 1000000), 1000000)
        period = int(safe_float(data.get('period', 30), 30))
        period = max(1, min(period, 365))

        strategy_fn = STRATEGY_MAP.get(strategy)
        if not strategy_fn:
            return jsonify({'success': False, 'error': '未知策略: %s' % strategy}), 400

        # 获取策略选股结果
        selected = strategy_fn()[:10]

        if not selected:
            return jsonify({
                'success': True,
                'data': {
                    'total_return': 0,
                    'annual_return': 0,
                    'max_drawdown': 0,
                    'sharpe': 0,
                    'equity_curve': [],
                    'holdings': [],
                    'message': '当前市场条件下该策略未筛选到符合条件的股票',
                }
            })

        # 取前10只等权配置
        weight = 1.0 / len(selected)
        daily_returns = []
        for s in selected:
            daily_returns.append(s.get('change_percent', 0) / 100.0)

        # 平均日收益率
        avg_daily = sum(daily_returns) / len(daily_returns)
        mean_r = avg_daily
        variance = sum((r - mean_r) ** 2 for r in daily_returns) / len(daily_returns)
        daily_std = math.sqrt(variance) if variance > 0 else 0.001

        # 模拟 period 天的权益曲线
        random.seed(42)
        equity_curve = []
        current_equity = initial_capital
        peak_equity = initial_capital
        max_drawdown = 0.0

        for day in range(1, period + 1):
            noise = random.gauss(0, daily_std * 0.5)
            day_return = avg_daily + noise
            current_equity *= (1 + day_return)

            if current_equity > peak_equity:
                peak_equity = current_equity

            drawdown = (peak_equity - current_equity) / peak_equity * 100 if peak_equity > 0 else 0
            if drawdown > max_drawdown:
                max_drawdown = drawdown

            equity_curve.append({
                'day': day,
                'equity': round(current_equity, 2),
                'return_pct': round((current_equity / initial_capital - 1) * 100, 2),
                'daily_return': round(day_return * 100, 4),
            })

        total_return = (current_equity / initial_capital - 1) * 100
        annual_return = total_return / period * 250
        annual_std = daily_std * math.sqrt(250) * 100
        sharpe = (annual_return - 3) / annual_std if annual_std > 0 else 0

        holdings = []
        for s in selected:
            holdings.append({
                'symbol': s['symbol'],
                'name': s['name'],
                'weight': round(weight * 100, 1),
                'price': s['price'],
                'pe': s.get('pe'),
                'pb': s.get('pb'),
                'market_cap': s.get('market_cap'),
                'change_percent': s.get('change_percent'),
                'roe': s.get('roe'),
                'np_growth': s.get('np_growth'),
                'gp_margin': s.get('gp_margin'),
            })

        return jsonify({
            'success': True,
            'data': {
                'strategy': strategy,
                'initial_capital': initial_capital,
                'period': period,
                'final_equity': round(current_equity, 2),
                'total_return': round(total_return, 2),
                'annual_return': round(annual_return, 2),
                'max_drawdown': round(max_drawdown, 2),
                'sharpe': round(sharpe, 2),
                'equity_curve': equity_curve,
                'holdings': holdings,
                'message': '策略筛选出 %d 只股票，等权配置模拟 %d 天' % (len(selected), period),
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== 启动 ====================

if __name__ == '__main__':
    # 初始化数据库
    init_db()

    # 启动后台同步线程
    threading.Thread(target=background_sync, daemon=True).start()

    print('A股行情 API: http://localhost:3081')
    print('数据源: 新浪实时行情 + AKShare (涨停池/财务报表)')
    print('缓存: SQLite (%s)' % DB_PATH)
    print('[startup] 服务启动中...')
    app.run(host='0.0.0.0', port=3081, debug=False, threaded=True)
