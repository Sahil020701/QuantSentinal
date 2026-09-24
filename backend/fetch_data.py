import sys
import os
import glob
import site
import json
import io
import urllib.request
import datetime
import pandas as pd
import yfinance as yf

# Ensure site-packages are discovered across user, venv, and system paths
def _setup_python_path():
    try:
        user_site = site.getusersitepackages()
        if user_site and user_site not in sys.path:
            sys.path.insert(0, user_site)
    except Exception:
        pass

    search_patterns = [
        os.path.join(os.path.dirname(__file__), "venv", "lib", "python*", "site-packages"),
        "/opt/render/project/src/backend/venv/lib/python*/site-packages",
        "/opt/render/.local/lib/python*/site-packages",
        "/opt/render/.local/lib/python*/dist-packages",
        "/root/.local/lib/python*/site-packages",
        "/usr/local/lib/python*/site-packages",
        "/usr/local/lib/python*/dist-packages"
    ]

    for pattern in search_patterns:
        for p in glob.glob(pattern):
            if os.path.isdir(p) and p not in sys.path:
                sys.path.insert(0, p)

_setup_python_path()

# Standard ETFs to include manually for macro indicators and sector indexing
ETFS = [
    {"symbol": "NIFTYBEES.NS", "name": "Nifty 50 ETF", "sector": "ETFs"},
    {"symbol": "BANKBEES.NS", "name": "Nifty Bank ETF", "sector": "ETFs"},
    {"symbol": "CPSEETF.NS", "name": "CPSE ETF", "sector": "ETFs"},
    {"symbol": "MON100.NS", "name": "Nasdaq 100 ETF", "sector": "ETFs"}
]

CORE_BUILTIN_WATCHLIST = [
    {"symbol": "RELIANCE.NS", "name": "Reliance Industries Ltd.", "sector": "Oil Gas & Consumable Fuels"},
    {"symbol": "TCS.NS", "name": "Tata Consultancy Services Ltd.", "sector": "Information Technology"},
    {"symbol": "HDFCBANK.NS", "name": "HDFC Bank Ltd.", "sector": "Financial Services"},
    {"symbol": "INFY.NS", "name": "Infosys Ltd.", "sector": "Information Technology"},
    {"symbol": "ICICIBANK.NS", "name": "ICICI Bank Ltd.", "sector": "Financial Services"},
    {"symbol": "SBIN.NS", "name": "State Bank of India", "sector": "Financial Services"},
    {"symbol": "BHARTIARTL.NS", "name": "Bharti Airtel Ltd.", "sector": "Telecommunication"},
    {"symbol": "ITC.NS", "name": "ITC Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "LICI.NS", "name": "Life Insurance Corporation of India", "sector": "Financial Services"},
    {"symbol": "LT.NS", "name": "Larsen & Toubro Ltd.", "sector": "Construction"},
    {"symbol": "HINDUNILVR.NS", "name": "Hindustan Unilever Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "BAJFINANCE.NS", "name": "Bajaj Finance Ltd.", "sector": "Financial Services"},
    {"symbol": "TATAMOTORS.NS", "name": "Tata Motors Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "SUNPHARMA.NS", "name": "Sun Pharmaceutical Industries Ltd.", "sector": "Healthcare"},
    {"symbol": "MARUTI.NS", "name": "Maruti Suzuki India Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "KOTAKBANK.NS", "name": "Kotak Mahindra Bank Ltd.", "sector": "Financial Services"},
    {"symbol": "AXISBANK.NS", "name": "Axis Bank Ltd.", "sector": "Financial Services"},
    {"symbol": "NTPC.NS", "name": "NTPC Ltd.", "sector": "Power"},
    {"symbol": "ONGC.NS", "name": "Oil & Natural Gas Corporation Ltd.", "sector": "Oil Gas & Consumable Fuels"},
    {"symbol": "TITAN.NS", "name": "Titan Company Ltd.", "sector": "Consumer Durables"},
    {"symbol": "ADANIENT.NS", "name": "Adani Enterprises Ltd.", "sector": "Metals & Mining"},
    {"symbol": "ADANIPORTS.NS", "name": "Adani Ports and Special Economic Zone Ltd.", "sector": "Services"},
    {"symbol": "POWERGRID.NS", "name": "Power Grid Corporation of India Ltd.", "sector": "Power"},
    {"symbol": "COALINDIA.NS", "name": "Coal India Ltd.", "sector": "Oil Gas & Consumable Fuels"},
    {"symbol": "WIPRO.NS", "name": "Wipro Ltd.", "sector": "Information Technology"},
    {"symbol": "HCLTECH.NS", "name": "HCL Technologies Ltd.", "sector": "Information Technology"},
    {"symbol": "BAJAJFINSV.NS", "name": "Bajaj Finserv Ltd.", "sector": "Financial Services"},
    {"symbol": "TATASTEEL.NS", "name": "Tata Steel Ltd.", "sector": "Metals & Mining"},
    {"symbol": "ULTRACEMCO.NS", "name": "UltraTech Cement Ltd.", "sector": "Construction Materials"},
    {"symbol": "ASIANPAINT.NS", "name": "Asian Paints Ltd.", "sector": "Consumer Durables"},
    # ── Stocks added to guarantee coverage (may fall out of live NSE Nifty 200 CSV) ──
    {"symbol": "TATAMOTORS.NS", "name": "Tata Motors Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "BAJAJ-AUTO.NS", "name": "Bajaj Auto Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "MAXHEALTH.NS", "name": "Max Healthcare Institute Ltd.", "sector": "Healthcare"},
    {"symbol": "BOSCHLTD.NS", "name": "Bosch Ltd.", "sector": "Capital Goods"},
    {"symbol": "DLF.NS", "name": "DLF Ltd.", "sector": "Realty"},
    {"symbol": "DIVISLAB.NS", "name": "Divi's Laboratories Ltd.", "sector": "Healthcare"},
    {"symbol": "TVSMOTOR.NS", "name": "TVS Motor Company Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "LODHA.NS", "name": "Macrotech Developers Ltd.", "sector": "Realty"},
    {"symbol": "MOTHERSON.NS", "name": "Samvardhana Motherson International Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "SYRMA.NS", "name": "Syrma SGS Technology Ltd.", "sector": "Capital Goods"},
    {"symbol": "PTCIL.NS", "name": "PTC Industries Ltd.", "sector": "Capital Goods"},
]

def load_fallback_watchlist(output_file):
    fallback_file = os.path.join(os.path.dirname(__file__), "data", "watchlist_fallback.json")
    if os.path.exists(fallback_file):
        try:
            with open(fallback_file, "r") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    return data
        except Exception:
            pass

    if os.path.exists(output_file):
        try:
            with open(output_file, "r") as f:
                data = json.load(f)
                if isinstance(data, dict) and "watchlist" in data and len(data["watchlist"]) > 0:
                    return data["watchlist"]
        except Exception:
            pass

    # Built-in default
    return ETFS + CORE_BUILTIN_WATCHLIST

def fetch_watchlist(output_file):
    urls = [
        'https://archives.nseindia.com/content/indices/ind_nifty200list.csv',
        'https://niftyindices.com/IndexConstituent/ind_nifty200list.csv'
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.nseindia.com/'
    }

    for url in urls:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as response:
                content = response.read()
                df = pd.read_csv(io.BytesIO(content))
                if 'Symbol' in df.columns and ('Industry' in df.columns or 'Company Name' in df.columns):
                    industry_col = 'Industry' if 'Industry' in df.columns else df.columns[1]
                    name_col = 'Company Name' if 'Company Name' in df.columns else 'Symbol'
                    selected_df = df.groupby(industry_col).head(20)

                    watchlist = []
                    for etf in ETFS:
                        watchlist.append(etf)

                    for _, row in selected_df.iterrows():
                        sym = str(row['Symbol']).strip() + '.NS'
                        watchlist.append({
                            "symbol": sym,
                            "name": str(row[name_col]).strip(),
                            "sector": str(row[industry_col]).strip()
                        })
                    print(f"Successfully downloaded live Nifty 200 list from {url} ({len(watchlist)} assets).", file=sys.stderr)
                    return watchlist
        except Exception as e:
            print(f"Note: Live fetch from {url} returned: {e}", file=sys.stderr)

    print("Falling back to cached/built-in Nifty 200 watchlist.", file=sys.stderr)
    return load_fallback_watchlist(output_file)

def main():
    if len(sys.argv) < 4:
        print("Usage: python3 fetch_data.py <start_date> <end_date> <output_file>")
        sys.exit(1)
        
    start_date = sys.argv[1]
    end_date = sys.argv[2]
    output_file = sys.argv[3]
    
    # Make end_date inclusive by incrementing by 1 day for yfinance exclusive boundary
    try:
        end_dt = datetime.datetime.strptime(end_date, '%Y-%m-%d')
        inclusive_end = (end_dt + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    except Exception:
        inclusive_end = end_date
    
    print(f"Starting market data fetch (start={start_date}, end={inclusive_end})...", file=sys.stderr)
    try:
        watchlist = fetch_watchlist(output_file)
        tickers = [a["symbol"] for a in watchlist]
        
        print(f"Watchlist compiled: {len(watchlist)} assets. Fetching price history in batch via yfinance...", file=sys.stderr)
        
        # Download in a single batch request using inclusive end date
        data = yf.download(tickers, start=start_date, end=inclusive_end, group_by='ticker', progress=False)
        
        output_dict = {}
        successful_tickers = []
        
        is_multi_index = isinstance(data.columns, pd.MultiIndex)
        
        for asset in watchlist:
            ticker = asset["symbol"]
            ticker_df = None
            
            if is_multi_index:
                if ticker in data.columns.get_level_values(0):
                    ticker_df = data[ticker]
                elif ticker in data.columns.get_level_values(1):
                    ticker_df = data.xs(ticker, axis=1, level=1)
            else:
                if len(tickers) == 1 and 'Close' in data.columns:
                    ticker_df = data
            
            if ticker_df is None or 'Close' not in ticker_df.columns:
                continue
                
            clean_df = ticker_df.dropna(subset=['Close'])
            if len(clean_df) == 0:
                continue
                
            bars = []
            for date_stamp, row in clean_df.iterrows():
                try:
                    date_str = date_stamp.strftime('%Y-%m-%d')
                    bars.append({
                        "date": date_str,
                        "open": float(row['Open']),
                        "high": float(row['High']),
                        "low": float(row['Low']),
                        "close": float(row['Close']),
                        "volume": int(row['Volume'])
                    })
                except (ValueError, TypeError, KeyError):
                    continue
            
            if len(bars) > 0:
                output_dict[ticker] = bars
                successful_tickers.append(ticker)
            
        # Filter watchlist to include only successfully fetched assets
        final_watchlist = [a for a in watchlist if a["symbol"] in successful_tickers]
        
        # Ensure target directory exists
        out_dir = os.path.dirname(output_file)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        # Save cache with dynamic watchlist included
        with open(output_file, 'w') as f:
            json.dump({
                "lastUpdated": end_date,
                "watchlist": final_watchlist,
                "data": output_dict
            }, f, indent=2)
            
        print(f"SUCCESS: Cached data for {len(final_watchlist)} stocks/ETFs.", file=sys.stderr)
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(2)

if __name__ == '__main__':
    main()
