# Holded Sync

Automated daily sync of products and sales from multiple WooCommerce sites, Square, and Hotel Bookings (MotoPress) to [Holded](https://www.holded.com/) (Spanish accounting/invoicing software).

## Architecture

```
WooCommerce Sites (x3) ──┐
                          │
Square Payments ──────────┼──► holded-sync ──► Holded API
                          │         │
Hotel Bookings (MPHB) ────┘         └──► Excel exports (backup)
```

## Features

- **Product Sync**: Import products from multiple WooCommerce sites to Holded (with per-site SKU prefixes)
- **Sales Sync**: Daily WooCommerce orders → Holded invoices/receipts
- **Square Sync**: Daily Square transactions → Holded invoices/receipts, with category-to-account mapping
- **Hotel Bookings Sync**: Daily MotoPress Hotel Booking reservations → Holded invoices/receipts
- **Multi-account routing**: Route specific SKUs to a secondary Holded account
- **Excel Export**: Generate Holded-compatible Excel files as backup or for manual import
- **Scheduled Execution**: Designed to run daily at 8:00 AM via cron
- **Custom Date Ranges**: Sync any date range on demand

## Setup

### 1. Install Dependencies

```bash
npm install
```

Requires Node.js >= 18.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials. See [Environment Variables](#environment-variables) below.

### 3. Schedule (Optional)

Add to crontab (`crontab -e`):

```bash
0 8 * * * cd /path/to/holded-sync && node src/index.js >> logs/sync.log 2>&1
```

## Usage

```bash
# Full sync (products + WooCommerce sales + Square + hotel bookings)
npm run sync

# Products only
npm run sync:products

# WooCommerce sales only (yesterday by default)
npm run sync:sales

# Square transactions only (yesterday by default)
npm run sync:square

# Hotel bookings only (yesterday by default)
npm run sync:bookings

# Excel export only (no Holded API calls)
npm run export

# Custom date range
node src/index.js --sales --from 2025-01-01 --to 2025-01-15
node src/index.js --square --from 2025-01-01 --to 2025-01-15
node src/index.js --bookings --from 2025-01-01 --to 2025-01-15
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HOLDED_API_KEY` | Yes | Holded API key (Settings > Developers) |
| `HOLDED_SECONDARY_API_KEY` | No | Secondary Holded account API key |
| `HOLDED_SECONDARY_SKUS` | No | Comma-separated SKUs to route to secondary account |
| `EXCLUDED_SKUS` | No | Comma-separated SKUs to skip during sync |
| `HOLDED_DOC_TYPE` | No | Document type: `invoice`, `salesreceipt`, etc. (default: `invoice`) |
| `HOLDED_NUMBERING_FORMAT` | No | Numbering format, e.g. `F[YY]%%%%` |
| `WC_SITE{N}_URL` | Yes* | WooCommerce site URL |
| `WC_SITE{N}_KEY` | Yes* | WooCommerce consumer key (`ck_...`) |
| `WC_SITE{N}_SECRET` | Yes* | WooCommerce consumer secret (`cs_...`) |
| `WC_SITE{N}_PREFIX` | Yes* | SKU prefix for this site |
| `WC_SITE{N}_DEFAULT_VAT_RATE` | No | Site-specific VAT rate |
| `WC_SITE{N}_PRICES_INCLUDE_TAX` | No | Whether prices include tax |
| `SQUARE_ACCESS_TOKEN` | No | Square Personal Access Token |
| `SQUARE_LOCATION_ID` | No | Filter by Square location |
| `HOTEL_KEY` | No | MotoPress Hotel Booking API key |
| `HOTEL_SECRET` | No | MotoPress Hotel Booking API secret |
| `HOTEL_URL` | No | Hotel site URL (defaults to `WC_SITE1_URL`) |
| `HOTEL_PRODUCT_SKU` | No | Holded product SKU for all bookings |
| `HOTEL_DEFAULT_VAT_RATE` | No | Hotel VAT rate (default: 10%) |
| `DEFAULT_VAT_RATE` | No | Global fallback VAT rate (default: 21%) |
| `SYNC_DAYS_BACK` | No | Days to look back for sales (default: 1) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |
| `TZ` | No | Timezone (default: `Europe/Madrid`) |

\* At least one WooCommerce site is required for product/sales sync.

## API Credentials

### WooCommerce
Generate at: WooCommerce > Settings > Advanced > REST API. Permissions: **Read only**.

### Square
1. Go to [Square Developer Console](https://developer.squareup.com/)
2. Under Credentials > Production, copy your **Personal Access Token**
3. Note your Location ID from the Locations tab (optional)

### Holded
Generate at: Settings > Developers > New API Key.

### MotoPress Hotel Booking
Generate at: Accommodation > Settings > Advanced > REST API.

## File Structure

```
holded-sync/
├── src/
│   ├── index.js              # Entry point & CLI args
│   ├── config.js             # Environment config
│   ├── squareAccounts.js     # Square category → Holded account mapping
│   ├── sources/
│   │   ├── woocommerce.js    # WooCommerce API client (read-only)
│   │   ├── square.js         # Square API client (read-only)
│   │   └── hotelBookings.js  # MotoPress Hotel Booking client (read-only)
│   ├── destinations/
│   │   ├── holded.js         # Holded API client (products, contacts, invoices)
│   │   └── excel.js          # Excel export (Holded import format)
│   └── utils/
│       ├── logger.js         # Winston logger
│       └── date.js           # Date formatting helpers
├── exports/                  # Generated Excel files
├── logs/                     # Log files
├── .env.example
├── package.json
└── README.md
```

## Troubleshooting

- **Rate Limiting**: Holded may return 503 errors; the script includes delays between API calls
- **Duplicate Invoices**: There is no dedup — running the same date range twice will create duplicates
- **Duplicate Products**: Products are matched by SKU (prefixed per site)
- **Missing Orders**: Check date range, order status filters, and timezone settings
- **Logs**: Check `logs/sync.log` for detailed output

## License

MIT
