#!/usr/bin/env node
import minimist from 'minimist';
import {
  config,
  validateConfig,
  filterProductsByDestination,
  filterOrdersByDestination
} from './config.js';
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

  // Create Holded clients - secondary only if configured
  const holdedPrimary = excelOnly ? null : new HoldedClient(config.holded.apiKey, 'primary');
  const holdedSecondary = (excelOnly || config.holdedSecondary.skus.length === 0) ? null :
    new HoldedClient(config.holdedSecondary.apiKey, 'secondary');

  const results = {
    products: {
      total: 0,
      primary: { synced: 0, errors: 0 },
      secondary: { synced: 0, errors: 0 }
    },
    orders: {
      total: 0,
      primary: { synced: 0, errors: 0 },
      secondary: { synced: 0, errors: 0 }
    }
  };

  try {
    // ============================================
    // PRODUCTS SYNC
    // ============================================
    if (syncProducts) {
      logger.info('-'.repeat(40));
      logger.info('PRODUCTS SYNC');
      logger.info('-'.repeat(40));

      const allProducts = await fetchAllWooCommerceProducts(config.woocommerce);
      results.products.total = allProducts.length;

      if (allProducts.length > 0) {
        // Always export to Excel as backup
        await exportProductsToExcel(allProducts);

        if (!excelOnly) {
          // Filter products by destination
          const { primary: primaryProducts, secondary: secondaryProducts } =
            filterProductsByDestination(allProducts);

          logger.info(`Product distribution: ${primaryProducts.length} primary, ${secondaryProducts.length} secondary`);

          // Sync primary products
          if (primaryProducts.length > 0 && holdedPrimary) {
            const primaryResult = await holdedPrimary.syncProducts(primaryProducts, config.woocommerce);
            results.products.primary.synced = primaryResult.created + primaryResult.updated;
            results.products.primary.errors = primaryResult.errors;
          }

          // Sync secondary products with secondary VAT rate
          if (secondaryProducts.length > 0 && holdedSecondary) {
            // Create temporary site config with secondary VAT rate for secondary products
            const secondarySiteConfigs = config.woocommerce.map(site => ({
              ...site,
              defaultVatRate: config.holdedSecondary.vatRate
            }));

            const secondaryResult = await holdedSecondary.syncProducts(secondaryProducts, secondarySiteConfigs);
            results.products.secondary.synced = secondaryResult.created + secondaryResult.updated;
            results.products.secondary.errors = secondaryResult.errors;
          }
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
          // Filter orders by destination based on SKUs
          const { primary: primaryOrders, secondary: secondaryOrders } =
            filterOrdersByDestination(allOrders);

          logger.info(`Order distribution: ${primaryOrders.length} primary, ${secondaryOrders.length} secondary`);

          // Sync primary orders
          if (primaryOrders.length > 0 && holdedPrimary) {
            const primaryResult = await holdedPrimary.syncOrders(primaryOrders, config.holded.docType, config.woocommerce);
            results.orders.primary.synced = primaryResult.created;
            results.orders.primary.errors = primaryResult.errors;
          }

          // Sync secondary orders with secondary VAT rate
          if (secondaryOrders.length > 0 && holdedSecondary) {
            // Create temporary site config with secondary VAT rate for secondary orders
            const secondarySiteConfigs = config.woocommerce.map(site => ({
              ...site,
              defaultVatRate: config.holdedSecondary.vatRate
            }));

            const secondaryResult = await holdedSecondary.syncOrders(secondaryOrders, config.holded.docType, secondarySiteConfigs);
            results.orders.secondary.synced = secondaryResult.created;
            results.orders.secondary.errors = secondaryResult.errors;
          }
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
      const totalProductsSynced = results.products.primary.synced + results.products.secondary.synced;
      const totalProductErrors = results.products.primary.errors + results.products.secondary.errors;
      logger.info(`Products: ${results.products.total} found, ${totalProductsSynced} synced, ${totalProductErrors} errors`);

      if (holdedSecondary) {
        logger.info(`  Primary account: ${results.products.primary.synced} synced, ${results.products.primary.errors} errors`);
        logger.info(`  Secondary account: ${results.products.secondary.synced} synced, ${results.products.secondary.errors} errors`);
      }
    }

    if (syncSales) {
      const totalOrdersSynced = results.orders.primary.synced + results.orders.secondary.synced;
      const totalOrderErrors = results.orders.primary.errors + results.orders.secondary.errors;
      logger.info(`Orders: ${results.orders.total} found, ${totalOrdersSynced} synced, ${totalOrderErrors} errors`);

      if (holdedSecondary) {
        logger.info(`  Primary account: ${results.orders.primary.synced} synced, ${results.orders.primary.errors} errors`);
        logger.info(`  Secondary account: ${results.orders.secondary.synced} synced, ${results.orders.secondary.errors} errors`);
      }
    }

    // Exit with error code if there were failures
    const totalErrors = results.products.primary.errors + results.products.secondary.errors +
                       results.orders.primary.errors + results.orders.secondary.errors;
    if (totalErrors > 0) {
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
