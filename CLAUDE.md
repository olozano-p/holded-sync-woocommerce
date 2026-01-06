# Holded Sync - Project Context for Claude Code

## Project Overview

A Node.js automation tool that syncs products and sales from multiple WooCommerce sites and SumUp to Holded (Spanish accounting/invoicing software). Runs daily at 8 AM via cron.

## Architecture

```
WooCommerce Sites (x3) ──┐
                         ├──► holded-sync ──► Holded API
SumUp Transactions ──────┘         │
                                   └──► Excel exports (backup)
```

## Key Files

- `src/index.js` - Main entry point, CLI argument handling
- `src/config.js` - Environment variables and configuration
- `src/sources/woocommerce.js` - WooCommerce REST API client (READ-ONLY)
- `src/sources/sumup.js` - SumUp API client (READ-ONLY) 
- `src/destinations/holded.js` - Holded API client (writes products, contacts, invoices)
- `src/destinations/excel.js` - Excel export matching Holded import format
- `src/utils/logger.js` - Winston logger
- `src/utils/date.js` - Date formatting helpers

## Commands

```bash
npm run sync              # Full sync (products + sales)
npm run sync:products     # Products only
npm run sync:sales        # Yesterday's sales only
npm run export            # Excel export only (no API calls to Holded)

# Custom date range
node src/index.js --sales --from 2025-01-01 --to 2025-01-15
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

### SumUp API (TO BE IMPLEMENTED)
- Base URL: `https://api.sumup.com/v0.1`
- Auth: Bearer token or OAuth2
- Docs: https://developer.sumup.com/api

Key endpoints:
- `GET /me/transactions/history` - List transactions with date filters

**SumUp Auth Options:**
1. API Key (simple): Generate at https://developer.sumup.com/ with `transactions.history` scope
2. OAuth2 (for more scopes): Client ID + Secret flow

Current implementation expects Bearer token auth. May need OAuth2 flow for production use.

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

## Known Issues / TODOs

1. **SumUp integration incomplete** - Auth works but needs testing with real credentials
2. **Rate limiting** - Holded sometimes returns 503; current sleep delays may need tuning
3. **Tax rates** - Products currently skip tax (Holded uses defaults); invoices extract tax from WooCommerce line items
4. **Inventory app** - Holded rejects `stock` field without Inventory subscription; removed from product sync
5. **Duplicate detection** - Products matched by SKU; invoices have no dedup (will create duplicates if run twice for same date range)

## Environment Variables

```bash
# Required
HOLDED_API_KEY=           # From Holded: Ajustes → Desarrolladores

# WooCommerce (at least one site)
WC_SITE1_URL=             # e.g., https://example.com
WC_SITE1_KEY=             # Consumer key (ck_...)
WC_SITE1_SECRET=          # Consumer secret (cs_...)
WC_SITE1_PREFIX=          # SKU prefix, e.g., SITE1

# Optional
SUMUP_API_KEY=            # Leave empty to skip SumUp
HOLDED_DOC_TYPE=invoice   # or salesreceipt
DEFAULT_VAT_RATE=21       # Fallback tax rate
SYNC_DAYS_BACK=1          # Default lookback for sales
LOG_LEVEL=info            # debug, info, warn, error
TZ=Europe/Madrid
```

## Testing

```bash
# Test with Excel export only (no API writes)
node src/index.js --excel-only

# Test single day
node src/index.js --sales --from 2025-12-28 --to 2025-12-28

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
- Axios for HTTP (except WooCommerce which uses their SDK)
- No TypeScript, plain JavaScript

## Important Constraints

- **WooCommerce and SumUp are READ-ONLY** - Never modify source data
- **Holded is the only write target** - Products, contacts, invoices
- **Spanish context** - Dates as dd/mm/yyyy, VAT (IVA), Spanish field names in Excel exports

