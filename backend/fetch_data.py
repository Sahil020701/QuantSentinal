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

# Core stocks always included regardless of whether live CSV download succeeds.
# These guarantee coverage of high-momentum stocks that may not always appear in index CSVs.
CORE_BUILTIN_WATCHLIST = [
    # ── Nifty 50 Heavyweights ──
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
    # ── User-specified high-momentum stocks (always scan regardless of index membership) ──
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
    {"symbol": "COFORGE.NS", "name": "Coforge Ltd.", "sector": "Information Technology"},
    {"symbol": "ETERNAL.NS", "name": "Eternal Ltd.", "sector": "Consumer Services"},
    {"symbol": "SWIGGY.NS", "name": "Swiggy Ltd.", "sector": "Consumer Services"},
    {"symbol": "LENSKART.NS", "name": "Lenskart Solutions Ltd.", "sector": "Consumer Services"},
    {"symbol": "ABB.NS", "name": "ABB India Ltd.", "sector": "Capital Goods"},
    {"symbol": "EICHERMOT.NS", "name": "Eicher Motors Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "MAZDOCK.NS", "name": "Mazagoan Dock Shipbuilders Ltd.", "sector": "Capital Goods"},
    {"symbol": "COCHINSHIP.NS", "name": "Cochin Shipyard Ltd.", "sector": "Capital Goods"},
    {"symbol": "UNITDSPR.NS", "name": "United Spirits Ltd.", "sector": "Fast Moving Consumer Goods"},
    # ── Key Midcap momentum stocks ──
    {"symbol": "PERSISTENT.NS", "name": "Persistent Systems Ltd.", "sector": "Information Technology"},
    {"symbol": "LTIM.NS", "name": "LTIMindtree Ltd.", "sector": "Information Technology"},
    {"symbol": "MPHASIS.NS", "name": "Mphasis Ltd.", "sector": "Information Technology"},
    {"symbol": "OFSS.NS", "name": "Oracle Financial Services Software Ltd.", "sector": "Information Technology"},
    {"symbol": "KALYANKJIL.NS", "name": "Kalyan Jewellers India Ltd.", "sector": "Consumer Durables"},
    {"symbol": "KPITTECH.NS", "name": "KPIT Technologies Ltd.", "sector": "Information Technology"},
    {"symbol": "TATAELXSI.NS", "name": "Tata Elxsi Ltd.", "sector": "Information Technology"},
    {"symbol": "LAURUSLABS.NS", "name": "Laurus Labs Ltd.", "sector": "Healthcare"},
    {"symbol": "APLLTD.NS", "name": "Alkem Laboratories Ltd.", "sector": "Healthcare"},
    {"symbol": "CIPLA.NS", "name": "Cipla Ltd.", "sector": "Healthcare"},
    {"symbol": "DRREDDY.NS", "name": "Dr. Reddy's Laboratories Ltd.", "sector": "Healthcare"},
    {"symbol": "ZYDUSLIFE.NS", "name": "Zydus Lifesciences Ltd.", "sector": "Healthcare"},
    {"symbol": "TORNTPHARM.NS", "name": "Torrent Pharmaceuticals Ltd.", "sector": "Healthcare"},
    {"symbol": "POLYCAB.NS", "name": "Polycab India Ltd.", "sector": "Capital Goods"},
    {"symbol": "HAVELLS.NS", "name": "Havells India Ltd.", "sector": "Capital Goods"},
    {"symbol": "VOLTAS.NS", "name": "Voltas Ltd.", "sector": "Consumer Durables"},
    {"symbol": "BLUEDART.NS", "name": "Blue Dart Express Ltd.", "sector": "Services"},
    {"symbol": "INDIAMART.NS", "name": "IndiaMART InterMESH Ltd.", "sector": "Information Technology"},
    {"symbol": "NAUKRI.NS", "name": "Info Edge (India) Ltd.", "sector": "Information Technology"},
    {"symbol": "ZOMATO.NS", "name": "Zomato Ltd.", "sector": "Consumer Services"},
    {"symbol": "PAYTM.NS", "name": "One 97 Communications Ltd.", "sector": "Financial Services"},
    {"symbol": "NYKAA.NS", "name": "FSN E-Commerce Ventures Ltd.", "sector": "Consumer Services"},
    {"symbol": "DELHIVERY.NS", "name": "Delhivery Ltd.", "sector": "Services"},
    {"symbol": "ASTRAL.NS", "name": "Astral Ltd.", "sector": "Capital Goods"},
    {"symbol": "SUPREMEIND.NS", "name": "Supreme Industries Ltd.", "sector": "Capital Goods"},
    {"symbol": "APLAPOLLO.NS", "name": "APL Apollo Tubes Ltd.", "sector": "Metals & Mining"},
    {"symbol": "GODREJPROP.NS", "name": "Godrej Properties Ltd.", "sector": "Realty"},
    {"symbol": "PRESTIGE.NS", "name": "Prestige Estates Projects Ltd.", "sector": "Realty"},
    {"symbol": "OBEROIRLTY.NS", "name": "Oberoi Realty Ltd.", "sector": "Realty"},
    {"symbol": "BRIGADE.NS", "name": "Brigade Enterprises Ltd.", "sector": "Realty"},
    {"symbol": "CONCOR.NS", "name": "Container Corporation of India Ltd.", "sector": "Services"},
    {"symbol": "IRCTC.NS", "name": "Indian Railway Catering & Tourism Corp.", "sector": "Services"},
    {"symbol": "IRFC.NS", "name": "Indian Railway Finance Corporation Ltd.", "sector": "Financial Services"},
    {"symbol": "RVNL.NS", "name": "Rail Vikas Nigam Ltd.", "sector": "Construction"},
    {"symbol": "TIINDIA.NS", "name": "Tube Investments of India Ltd.", "sector": "Capital Goods"},
    {"symbol": "SCHAEFFLER.NS", "name": "Schaeffler India Ltd.", "sector": "Capital Goods"},
    {"symbol": "CGPOWER.NS", "name": "CG Power and Industrial Solutions Ltd.", "sector": "Capital Goods"},
    {"symbol": "BHEL.NS", "name": "Bharat Heavy Electricals Ltd.", "sector": "Capital Goods"},
    {"symbol": "BEL.NS", "name": "Bharat Electronics Ltd.", "sector": "Capital Goods"},
    {"symbol": "HAL.NS", "name": "Hindustan Aeronautics Ltd.", "sector": "Capital Goods"},
    {"symbol": "SAIL.NS", "name": "Steel Authority of India Ltd.", "sector": "Metals & Mining"},
    {"symbol": "NMDC.NS", "name": "NMDC Ltd.", "sector": "Metals & Mining"},
    {"symbol": "HINDALCO.NS", "name": "Hindalco Industries Ltd.", "sector": "Metals & Mining"},
    {"symbol": "VEDL.NS", "name": "Vedanta Ltd.", "sector": "Metals & Mining"},
    {"symbol": "JSWSTEEL.NS", "name": "JSW Steel Ltd.", "sector": "Metals & Mining"},
    {"symbol": "BANKBARODA.NS", "name": "Bank of Baroda", "sector": "Financial Services"},
    {"symbol": "PNB.NS", "name": "Punjab National Bank", "sector": "Financial Services"},
    {"symbol": "CANBK.NS", "name": "Canara Bank", "sector": "Financial Services"},
    {"symbol": "FEDERALBNK.NS", "name": "The Federal Bank Ltd.", "sector": "Financial Services"},
    {"symbol": "INDUSINDBK.NS", "name": "IndusInd Bank Ltd.", "sector": "Financial Services"},
    {"symbol": "CHOLAFIN.NS", "name": "Cholamandalam Investment and Finance Co.", "sector": "Financial Services"},
    {"symbol": "MUTHOOTFIN.NS", "name": "Muthoot Finance Ltd.", "sector": "Financial Services"},
    {"symbol": "MANAPPURAM.NS", "name": "Manappuram Finance Ltd.", "sector": "Financial Services"},
    {"symbol": "SBICARD.NS", "name": "SBI Cards and Payment Services Ltd.", "sector": "Financial Services"},
    {"symbol": "HDFCAMC.NS", "name": "HDFC Asset Management Co. Ltd.", "sector": "Financial Services"},
    {"symbol": "NAUKRI.NS", "name": "Info Edge (India) Ltd.", "sector": "Information Technology"},
    {"symbol": "MARICO.NS", "name": "Marico Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "COLPAL.NS", "name": "Colgate-Palmolive (India) Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "DABUR.NS", "name": "Dabur India Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "TATACONSUM.NS", "name": "Tata Consumer Products Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "NESTLEIND.NS", "name": "Nestle India Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "BRITANNIA.NS", "name": "Britannia Industries Ltd.", "sector": "Fast Moving Consumer Goods"},
    {"symbol": "JUBLFOOD.NS", "name": "Jubilant FoodWorks Ltd.", "sector": "Consumer Services"},
    {"symbol": "M&M.NS", "name": "Mahindra & Mahindra Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "HEROMOTOCO.NS", "name": "Hero MotoCorp Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "ASHOKLEY.NS", "name": "Ashok Leyland Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "BALKRISIND.NS", "name": "Balkrishna Industries Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "MRF.NS", "name": "MRF Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "APOLLOTYRE.NS", "name": "Apollo Tyres Ltd.", "sector": "Automobile and Auto Components"},
    {"symbol": "GAIL.NS", "name": "GAIL (India) Ltd.", "sector": "Oil Gas & Consumable Fuels"},
    {"symbol": "IOC.NS", "name": "Indian Oil Corporation Ltd.", "sector": "Oil Gas & Consumable Fuels"},
    {"symbol": "BPCL.NS", "name": "Bharat Petroleum Corporation Ltd.", "sector": "Oil Gas & Consumable Fuels"},
    {"symbol": "TORNTPOWER.NS", "name": "Torrent Power Ltd.", "sector": "Power"},
    {"symbol": "TATAPOWER.NS", "name": "Tata Power Company Ltd.", "sector": "Power"},
    {"symbol": "CESC.NS", "name": "CESC Ltd.", "sector": "Power"},
    {"symbol": "ADANIGREEN.NS", "name": "Adani Green Energy Ltd.", "sector": "Power"},
    {"symbol": "ABCAPITAL.NS", "name": "Aditya Birla Capital Ltd.", "sector": "Financial Services"},
    {"symbol": "MFSL.NS", "name": "Max Financial Services Ltd.", "sector": "Financial Services"},
    {"symbol": "PIIND.NS", "name": "PI Industries Ltd.", "sector": "Chemicals"},
    {"symbol": "SRF.NS", "name": "SRF Ltd.", "sector": "Chemicals"},
    {"symbol": "DEEPAKNTR.NS", "name": "Deepak Nitrite Ltd.", "sector": "Chemicals"},
    {"symbol": "ATUL.NS", "name": "Atul Ltd.", "sector": "Chemicals"},
    {"symbol": "NAVINFLUOR.NS", "name": "Navin Fluorine International Ltd.", "sector": "Chemicals"},
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
    # Fetch from Nifty 200, Nifty Midcap 100, and Nifty Smallcap 100
    index_urls = [
        {
            "name": "Nifty 200",
            "urls": [
                'https://archives.nseindia.com/content/indices/ind_nifty200list.csv',
                'https://niftyindices.com/IndexConstituent/ind_nifty200list.csv'
            ]
        },
        {
            "name": "Nifty Midcap 100",
            "urls": [
                'https://archives.nseindia.com/content/indices/ind_niftymidcap100list.csv',
                'https://niftyindices.com/IndexConstituent/ind_niftymidcap100list.csv'
            ]
        },
        {
            "name": "Nifty Smallcap 100",
            "urls": [
                'https://archives.nseindia.com/content/indices/ind_niftysmallcap100list.csv',
                'https://niftyindices.com/IndexConstituent/ind_niftysmallcap100list.csv'
            ]
        }
    ]

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.nseindia.com/'
    }

    # Start watchlist with ETFs
    combined_watchlist = list(ETFS)
    seen_symbols = {e["symbol"] for e in ETFS}
    any_live_download = False

    for index_config in index_urls:
        fetched = False
        for url in index_config["urls"]:
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=10) as response:
                    content = response.read()
                    df = pd.read_csv(io.BytesIO(content))
                    if 'Symbol' in df.columns and ('Industry' in df.columns or 'Company Name' in df.columns):
                        industry_col = 'Industry' if 'Industry' in df.columns else df.columns[1]
                        name_col = 'Company Name' if 'Company Name' in df.columns else 'Symbol'

                        for _, row in df.iterrows():
                            sym = str(row['Symbol']).strip() + '.NS'
                            if sym not in seen_symbols:
                                seen_symbols.add(sym)
                                combined_watchlist.append({
                                    "symbol": sym,
                                    "name": str(row[name_col]).strip(),
                                    "sector": str(row[industry_col]).strip()
                                })
                        print(f"Downloaded {index_config['name']} from {url} ({len(df)} stocks).", file=sys.stderr)
                        fetched = True
                        any_live_download = True
                        break
            except Exception as e:
                print(f"Note: Live fetch from {url} returned: {e}", file=sys.stderr)
        if not fetched:
            print(f"Could not fetch {index_config['name']} from any URL.", file=sys.stderr)

    if any_live_download:
        print(f"Live universe compiled: {len(combined_watchlist)} total assets (Nifty 200 + Midcap 100 + Smallcap 100).", file=sys.stderr)
        return combined_watchlist

    # All live downloads failed — fall back to cached/built-in watchlist (CORE_BUILTIN_WATCHLIST used here only)
    print("All live downloads failed. Falling back to cached/built-in watchlist.", file=sys.stderr)
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
