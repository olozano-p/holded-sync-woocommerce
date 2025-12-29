# Holded Sync - WooCommerce & SumUp Integration

Automated daily sync of products and sales from WooCommerce sites and SumUp to Holded.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  WooCommerce 1  │     │  WooCommerce 2  │     │  WooCommerce 3  │
│  (Site A)       │     │  (Site B)       │     │  (Site C)       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    holded-sync          │
                    │                         │
                    │  1. Fetch products      │
                    │  2. Fetch orders        │
                    │  3. Transform data      │
                    │  4. Upload to Holded    │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  SumUp          │     │  Holded API     │     │  Excel Export   │
│  Transactions   │     │  (Products +    │     │  (Backup/Import)│
│                 │     │   Invoices)     │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Features

- **Product Sync**: Import products from 3 WooCommerce sites to Holded
- **Sales Sync**: 
  - Daily orders from WooCommerce → Holded invoices
  - Daily transactions from SumUp → Holded invoices
- **Scheduled Execution**: Runs daily at 8:00 AM via cron
- **Excel Export**: Generate Holded-compatible Excel files as backup

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

### 3. Configure Cron Job

Add to crontab (`crontab -e`):

```bash
0 8 * * * cd /path/to/holded-sync && node src/index.js >> logs/sync.log 2>&1
```

Or use the provided systemd timer (see `systemd/` folder).

## Configuration

Edit `config/sites.json` to configure your WooCommerce sites:

```json
{
  "woocommerce": [
    {
      "name": "Site A",
      "url": "https://site-a.com",
      "consumerKey": "ck_xxx",
      "consumerSecret": "cs_xxx",
      "prefix": "A"
    }
  ]
}
```

## API Credentials Needed

### WooCommerce (per site)
- Generate at: WooCommerce → Settings → Advanced → REST API
- Permissions: Read (for products and orders)

### SumUp
- Generate at: https://developer.sumup.com/
- Create API key with `transactions.history` scope

### Holded
- Generate at: Settings → Developers → New API Key

## File Structure

```
holded-sync/
├── src/
│   ├── index.js              # Main entry point
│   ├── config.js             # Configuration loader
│   ├── sources/
│   │   ├── woocommerce.js    # WooCommerce API client
│   │   └── sumup.js          # SumUp API client
│   ├── destinations/
│   │   ├── holded.js         # Holded API client
│   │   └── excel.js          # Excel export (fallback)
│   ├── transformers/
│   │   ├── product.js        # Product data transformer
│   │   └── order.js          # Order/transaction transformer
│   └── utils/
│       ├── logger.js         # Logging utility
│       └── date.js           # Date helpers
├── config/
│   └── sites.json            # Site configurations
├── logs/                     # Log files
├── exports/                  # Excel exports
├── .env.example
├── package.json
└── README.md
```

## Usage

### Manual Run

```bash
# Full sync (products + sales)
node src/index.js

# Products only
node src/index.js --products

# Sales only (yesterday's orders)
node src/index.js --sales

# Specific date range
node src/index.js --sales --from 2025-01-01 --to 2025-01-15

# Export to Excel only (no Holded upload)
node src/index.js --excel-only
```

### As a Cron Job

The default behavior syncs yesterday's sales data, making it ideal for a daily 8 AM run.

## Holded Import Format

Products are imported with this structure:

| Field | Description |
|-------|-------------|
| SKU | Unique product identifier (prefixed by site) |
| Nombre | Product name |
| Descripción | Product description |
| Precio venta (Subtotal) | Sale price (excl. tax) |
| Impuesto de venta | VAT percentage (21% default) |
| cat - Categoría | Product category |
| Tags | Tags separated by `-` |

## Troubleshooting

### Common Issues

1. **Rate Limiting**: The script includes automatic retry with exponential backoff
2. **Duplicate Products**: SKUs are prefixed with site identifier to avoid conflicts
3. **Missing Orders**: Check date range and order status filters

### Logs

Check `logs/sync.log` for detailed execution logs.

## License

MIT
