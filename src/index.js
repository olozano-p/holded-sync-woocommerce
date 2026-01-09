#!/usr/bin/env node
import minimist from 'minimist';
import { config, validateConfig } from './config.js';
import { logger } from './utils/logger.js';
import { getDateRange, getDaysAgo, getYesterday } from './utils/date.js';
import { fetchAllWooCommerceProducts, fetchAllWooCommerceOrders } from './sources/woocommerce.js';
import { fetchSumUpTransactions } from './sources/sumup.js';
import { HoldedClient } from './destinations/holded.js';
import { exportProductsToExcel, exportOrdersToExcel, exportSalesSummary } from './destinations/excel.js';

async function main() {
  const args = minimist(process.argv.slice(2), {
    boolean: ['products', 'sales', 'excel-only', 'help'],
    string: ['from', 'to'],
    default: {
      products: false,
      sales: false,
      'excel-only': false
    }
  });

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  logger.info('='.repeat(60));
  logger.info('Holded Sync - Starting');
  logger.info('='.repeat(60));

  validateConfig();

  // Determine what to sync
  const syncProducts = args.products || (!args.products && !args.sales);
  const syncSales = args.sales || (!args.products && !args.sales);
  const excelOnly = args['excel-only'];

  // Date range for sales
  const dateFrom = args.from || getDaysAgo(config.sync.daysBack);
  const dateTo = args.to || getYesterday();

  const holded = excelOnly ? null : new HoldedClient();
  const results = {
    products: { total: 0, synced: 0, errors: 0 },
    orders: { total: 0, synced: 0, errors: 0 }
  };

  try {
    // ============================================
    // PRODUCTS SYNC
    // ============================================
    if (syncProducts) {
      logger.info('-'.repeat(40));
      logger.info('PRODUCTS SYNC');
      logger.info('-'.repeat(40));

      const products = await fetchAllWooCommerceProducts(config.woocommerce);
      results.products.total = products.length;

      if (products.length > 0) {
        // Always export to Excel as backup
        await exportProductsToExcel(products);

        if (!excelOnly) {
          const syncResult = await holded.syncProducts(products, config.woocommerce);
          results.products.synced = syncResult.created + syncResult.updated;
          results.products.errors = syncResult.errors;
        }
      }
    }

    // ============================================
    // SALES SYNC
    // ============================================
    if (syncSales) {
      logger.info('-'.repeat(40));
      logger.info(`SALES SYNC (${dateFrom} to ${dateTo})`);
      logger.info('-'.repeat(40));

      // Fetch from all sources
      const [wcOrders, sumupTransactions] = await Promise.all([
        fetchAllWooCommerceOrders(config.woocommerce, dateFrom, dateTo),
        fetchSumUpTransactions(dateFrom, dateTo)
      ]);

      const allOrders = [...wcOrders, ...sumupTransactions];
      results.orders.total = allOrders.length;

      logger.info(`Total orders/transactions: ${allOrders.length} (WooCommerce: ${wcOrders.length}, SumUp: ${sumupTransactions.length})`);

      if (allOrders.length > 0) {
        // Export to Holded-compatible Excel format (for manual import if needed)
        await exportOrdersToExcel(allOrders);
        
        // Also export a simple summary for reporting
        await exportSalesSummary(allOrders);

        if (!excelOnly) {
          const syncResult = await holded.syncOrders(allOrders, config.holded.docType, config.woocommerce);
          results.orders.synced = syncResult.created;
          results.orders.errors = syncResult.errors;
        }
      }
    }

    // ============================================
    // SUMMARY
    // ============================================
    logger.info('='.repeat(60));
    logger.info('SYNC COMPLETE');
    logger.info('='.repeat(60));
    
    if (syncProducts) {
      logger.info(`Products: ${results.products.total} found, ${results.products.synced} synced, ${results.products.errors} errors`);
    }
    
    if (syncSales) {
      logger.info(`Orders: ${results.orders.total} found, ${results.orders.synced} synced, ${results.orders.errors} errors`);
    }

    // Exit with error code if there were failures
    if (results.products.errors > 0 || results.orders.errors > 0) {
      process.exit(1);
    }

  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Holded Sync - Sync products and sales from WooCommerce & SumUp to Holded

Usage: node src/index.js [options]

Options:
  --products      Sync products only
  --sales         Sync sales/orders only
  --from DATE     Start date for sales (YYYY-MM-DD)
  --to DATE       End date for sales (YYYY-MM-DD)
  --excel-only    Export to Excel without uploading to Holded
  --help          Show this help message

Examples:
  node src/index.js                    # Full sync (products + yesterday's sales)
  node src/index.js --products         # Products only
  node src/index.js --sales            # Yesterday's sales only
  node src/index.js --sales --from 2025-01-01 --to 2025-01-15
  node src/index.js --excel-only       # Export without uploading

Environment variables:
  See .env.example for required configuration
  `);
}

main();
