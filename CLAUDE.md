# Holded Sync - Project Context for Claude Code

## Project Overview

A Node.js automation tool that syncs products and sales from multiple WooCommerce sites, Square, and Hotel Bookings to Holded (Spanish accounting/invoicing software). Runs daily at 8 AM via cron.

## Architecture

```
WooCommerce Sites (x3) ──┐
                         │
Square Payments ─────────┼──► holded-sync ──► Holded API
                         │         │
Hotel Bookings (MPHB) ───┘         └──► Excel exports (backup)
```

## Key Files

- `src/index.js` - Main entry point, CLI argument handling
- `src/config.js` - Environment variables and configuration
- `src/sources/woocommerce.js` - WooCommerce REST API client (READ-ONLY)
- `src/sources/square.js` - Square API client (READ-ONLY)
- `src/sources/hotelBookings.js` - Hotel Bookings REST API client (READ-ONLY)
- `src/squareAccounts.js` - Square category to Holded account mapping
- `src/destinations/holded.js` - Holded API client (writes products, contacts, invoices)
- `src/destinations/excel.js` - Excel export matching Holded import format
- `src/utils/logger.js` - Winston logger
- `src/utils/date.js` - Date formatting helpers

## Commands

```bash
npm run sync              # Full sync (products + sales + hotel bookings)
npm run sync:products     # Products only
npm run sync:sales        # Yesterday's sales only (WooCommerce + Square)
npm run sync:square       # Yesterday's Square transactions only
npm run sync:bookings     # Yesterday's hotel bookings only
npm run export            # Excel export only (no API calls to Holded)

# Custom date range
node src/index.js --sales --from 2025-01-01 --to 2025-01-15
node src/index.js --square --from 2025-01-01 --to 2025-01-15
node src/index.js --bookings --from 2025-01-01 --to 2025-01-15
```

## API Documentation

### Holded API
- Base URL: `https://api.holded.com/api/invoicing/v1`
- Auth: Header `key: {API_KEY}`
- Docs: https://developers.holded.com/reference

Key endpoints:
- `GET /products` - List products
- `POST /products` - Create product
- `PUT /products/{id}` - Update product
- `GET /contacts` - List contacts
- `POST /contacts` - Create contact
- `POST /documents/{docType}` - Create invoice/receipt (docType: invoice, salesreceipt, etc.)
- `POST /documents/{docType}/{id}/pay` - Mark document as paid
- `GET /saleschannels`, `GET /warehouses`, `GET /paymentmethods` - Reference data

### WooCommerce REST API
- Auth: Basic auth with consumer key/secret, or query params
- Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
- Using `@woocommerce/woocommerce-rest-api` npm package

Key endpoints:
- `GET /products` - List products (paginated, 100 per page)
- `GET /orders` - List orders with date filters

### Square API
- Base URL: `https://connect.squareup.com/v2`
- Auth: Bearer token (Personal Access Token)
- Docs: https://developer.squareup.com/reference/square
- Using official `square` npm SDK

Key endpoints (via SDK):
- `client.payments.list()` - List payments with date filters
- `client.orders.retrieve()` - Get order details (line items, SKUs)
- `client.catalog.list()` - Get catalog items and categories

**Square Setup:**
1. Go to https://developer.squareup.com/ and sign in
2. Click Credentials in the left sidebar
3. Under Production tab, copy your Personal Access Token
4. Note your Location ID from the Locations tab

**Implementation Notes:**
- Fetches completed payments within date range
- For each payment with an order_id, fetches order details to get line items
- Categories are loaded from catalog to enable account mapping
- Payments mapped to Holded payment accounts based on payment type:
  - Card payments → "Square Balance"
  - Cash payments → "Square Cash Clearing"
  - Other payments → "Square Other Payments Clearing"
- Category-to-account mapping configured in `src/squareAccounts.js`

### MotoPress Hotel Booking REST API
- Endpoint: `/wp-json/mphb/v1/bookings`
- Auth: WordPress REST API Basic auth (consumer key/secret)
- Docs: https://motopress.github.io/hotel-booking-rest-api/
- Plugin: MotoPress Hotel Booking (typically installed on WC_SITE1)

Key endpoints:
- `GET /wp-json/mphb/v1/bookings` - List bookings with date filters

**Implementation Notes:**
- Uses same WordPress site as WC_SITE1 by default
- Bookings are normalized to order format for Holded sync
- Default VAT rate: 10% (Spanish hotel tax)
- Check-in/check-out dates stored in booking metadata

## Data Flow

### Products
```
WooCommerce Product → normalizeProduct() → Holded Product
{                      {                    {
  id, sku, name,   →     sku (prefixed),  →   name, sku, desc,
  price, tax_class       name, price,          price, tags, kind
}                        categories, tags   }
                       }
```

### Orders/Invoices
```
WooCommerce Order → normalizeOrder() → Holded Invoice
{                    {                  {
  id, number,    →     orderNumber,   →   contactId, date,
  billing,             customer {},        items [{
  line_items,          items [],             name, sku, units,
  total, tax           total, tax            subtotal, tax
}                    }                     }]
                                        }
```

### Square Payments
```
Square Payment → normalizeTransaction() → Holded Invoice
{                  {                        {
  id, amount,  →     orderNumber,       →     contactId, date,
  orderId,           customer {},              items [{
  createdAt,         items (from order         name, sku,
  status             or single item),          units, subtotal,
}                    total, tax,               tax, account
                     category (per item)     }]
                   }                        }
```

**Square Account Mapping:**
- Each Square item includes its category from the catalog
- Categories are mapped to Holded accounts in `src/squareAccounts.js`
- VAT rate is taken from the Holded product (if exists) or from Square item's actual tax

### Hotel Bookings
```
MPHB Booking → normalizeBooking() → Holded Invoice
{                {                    {
  id, dates,  →    orderNumber,     →   contactId, date,
  customer,        customer {},          items [{
  rooms,           items (rooms +         name, sku (HOTEL-*),
  services,        services),             units (nights),
  total            total, tax             subtotal, tax
}                }                      }]
                                     }
```

## Known Issues / TODOs

1. **SumUp integration incomplete** - Auth works but needs testing with real credentials
2. **Rate limiting** - Holded sometimes returns 503; current sleep delays may need tuning
3. **Tax rates** - Products currently skip tax (Holded uses defaults); invoices extract tax from WooCommerce line items
4. **Inventory app** - Holded rejects `stock` field without Inventory subscription; removed from product sync
5. **Duplicate detection** - Products matched by SKU; invoices have no dedup (will create duplicates if run twice for same date range)
6. **Hotel bookings** - All bookings use single product SKU (HOTEL_PRODUCT_SKU) to ensure correct cuenta contable; room/service names preserved in line item descriptions

## Environment Variables

```bash
# Required
HOLDED_API_KEY=           # From Holded: Ajustes → Desarrolladores

# WooCommerce (at least one site)
WC_SITE1_URL=             # e.g., https://example.com
WC_SITE1_KEY=             # Consumer key (ck_...)
WC_SITE1_SECRET=          # Consumer secret (cs_...)
WC_SITE1_PREFIX=          # SKU prefix, e.g., SITE1

# Hotel Bookings (MotoPress Hotel Booking)
HOTEL_NAME=Hotel Bookings       # Optional: name for logs
HOTEL_KEY=ck_xxxxxxxxxxxx       # MotoPress API key (Accommodation > Settings > Advanced)
HOTEL_SECRET=cs_xxxxxxxxxxxx    # MotoPress API secret
HOTEL_PRODUCT_SKU=HOTEL-RESERVA # Product SKU in Holded for all bookings (for correct cuenta contable)
HOTEL_DEFAULT_VAT_RATE=10       # Spanish hotel VAT (10%)
# HOTEL_URL=                    # Optional: defaults to WC_SITE1_URL

# Optional - Square
SQUARE_ACCESS_TOKEN=      # Personal Access Token from Square Developer Console
SQUARE_LOCATION_ID=       # Your Square location ID (optional, filters by location)
SQUARE_SANDBOX=false      # Set to true for sandbox testing
# Category-to-account mapping is in src/squareAccounts.js

# Other options
HOLDED_DOC_TYPE=invoice   # or salesreceipt
DEFAULT_VAT_RATE=21       # Fallback tax rate
SYNC_DAYS_BACK=1          # Default lookback for sales/bookings
LOG_LEVEL=info            # debug, info, warn, error
TZ=Europe/Madrid
```

## Testing

```bash
# Test with Excel export only (no API writes)
node src/index.js --excel-only

# Test single day for sales
node src/index.js --sales --from 2025-12-28 --to 2025-12-28

# Test Square transactions for specific date range
node src/index.js --square --from 2025-01-01 --to 2025-01-15

# Test hotel bookings for specific date range
node src/index.js --bookings --from 2025-01-01 --to 2025-01-31

# Check logs
tail -f logs/sync.log
```

## Holded Excel Import Formats

If API fails, Excel files in `/exports` can be manually imported:

- `productos_YYYY-MM-DD.xlsx` - Products import format (19 columns)
- `facturas_YYYY-MM-DD.xlsx` - Invoice import format (32 columns, multi-row per invoice for line items)
- `resumen_ventas_YYYY-MM-DD.xlsx` - Simple summary (not for import, just reporting)

## Code Style

- ES Modules (`"type": "module"` in package.json)
- Async/await throughout
- Winston for logging
- Axios for HTTP (except WooCommerce and Square which use their official SDKs)
- No TypeScript, plain JavaScript

## Important Constraints

- **WooCommerce, Square, and Hotel Bookings are READ-ONLY** - Never modify source data
- **Holded is the only write target** - Products, contacts, invoices
- **Spanish context** - Dates as dd/mm/yyyy, VAT (IVA), Spanish field names in Excel exports
- **Hotel bookings sync** - By default uses WC_SITE1 credentials if HOTEL_URL not specified
- **Square payments** - Marked as paid via payment method based on type (card → "Square Balance", cash → "Square Cash Clearing", other → "Square Other Payments Clearing"); category-to-account mapping in `src/squareAccounts.js`

