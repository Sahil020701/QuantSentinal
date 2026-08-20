import sys
import os
import glob
import site
import json

# Ensure user-installed site packages (e.g. on Render /opt/render/.local) are present in sys.path
user_site = site.getusersitepackages()
if user_site and user_site not in sys.path:
    sys.path.insert(0, user_site)

for site_pkg in glob.glob("/opt/render/.local/lib/python*/site-packages"):
    if site_pkg not in sys.path:
        sys.path.insert(0, site_pkg)

import pandas as pd
import yfinance as yf

# Standard ETFs to include manually for macro indicators and sector indexing
ETFS = [
    {"symbol": "NIFTYBEES.NS", "name": "Nifty 50 ETF", "sector": "ETFs"},
    {"symbol": "BANKBEES.NS", "name": "Nifty Bank ETF", "sector": "ETFs"},
    {"symbol": "CPSEETF.NS", "name": "CPSE ETF", "sector": "ETFs"},
    {"symbol": "MON100.NS", "name": "Nasdaq 100 ETF", "sector": "ETFs"}
]

def main():
    if len(sys.argv) < 4:
        print("Usage: python3 fetch_data.py <start_date> <end_date> <output_file>")
        sys.exit(1)
        
    start_date = sys.argv[1]
    end_date = sys.argv[2]
    output_file = sys.argv[3]
    
    import datetime
    # Make end_date inclusive by incrementing by 1 day for yfinance exclusive boundary
    try:
        end_dt = datetime.datetime.strptime(end_date, '%Y-%m-%d')
        inclusive_end = (end_dt + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    except Exception:
        inclusive_end = end_date
    
    print(f"Downloading dynamic watchlist from NSE Nifty 200 list (start={start_date}, end={inclusive_end})...", file=sys.stderr)
    try:
        # Fetch Nifty 200 list directly from NSE website
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        url = 'https://archives.nseindia.com/content/indices/ind_nifty200list.csv'
        df = pd.read_csv(url)
        
        # Limit to top 20 stocks per industry/sector to keep it balanced
        selected_df = df.groupby('Industry').head(20)
        
        watchlist = []
        tickers = []
        
        # Append ETFs first
        for etf in ETFS:
            watchlist.append(etf)
            tickers.append(etf["symbol"])
            
        # Append Nifty 200 stocks
        for _, row in selected_df.iterrows():
            sym = row['Symbol'] + '.NS'
            watchlist.append({
                "symbol": sym,
                "name": row['Company Name'],
                "sector": row['Industry']
            })
            tickers.append(sym)
            
        print(f"Watchlist compiled: {len(watchlist)} assets. Fetching price history in batch...", file=sys.stderr)
        
        # Download in a single batch request using inclusive end date
        data = yf.download(tickers, start=start_date, end=inclusive_end, group_by='ticker', progress=False)
        
        output_dict = {}
        successful_tickers = []
        
        for asset in watchlist:
            ticker = asset["symbol"]
            if ticker not in data.columns.levels[0]:
                continue
            
            ticker_df = data[ticker].dropna(subset=['Close'])
            if len(ticker_df) == 0:
                continue
                
            bars = []
            for date_stamp, row in ticker_df.iterrows():
                date_str = date_stamp.strftime('%Y-%m-%d')
                try:
                    bars.append({
                        "date": date_str,
                        "open": float(row['Open']),
                        "high": float(row['High']),
                        "low": float(row['Low']),
                        "close": float(row['Close']),
                        "volume": int(row['Volume'])
                    })
                except ValueError:
                    continue
            
            output_dict[ticker] = bars
            successful_tickers.append(ticker)
            
        # Filter watchlist to include only successfully fetched assets
        final_watchlist = [a for a in watchlist if a["symbol"] in successful_tickers]
        
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
