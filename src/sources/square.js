import { SquareClient, SquareEnvironment } from 'square';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class SquareSource {
  constructor() {
    this.client = new SquareClient({
      token: config.square.accessToken,
      environment: config.square.sandbox
        ? SquareEnvironment.Sandbox
        : SquareEnvironment.Production
    });
    this.locationId = config.square.locationId;

    // Catalog cache: maps catalogObjectId -> { name, categoryId, categoryName, sku }
    this.catalogItems = new Map();
    // Category cache: maps categoryId -> categoryName
    this.categories = new Map();
  }

  /**
   * Load catalog items and categories from Square
   * This allows us to get category info for line items
   */
  async loadCatalog() {
    logger.info('Loading Square catalog...');

    try {
      // First, load all categories
      let cursor = null;
      do {
        const params = { types: ['CATEGORY'], limit: 100 };
        if (cursor) params.cursor = cursor;

        const response = await this.client.catalog.list(params);

        if (response.objects) {
          for (const obj of response.objects) {
            if (obj.type === 'CATEGORY' && obj.categoryData) {
              this.categories.set(obj.id, obj.categoryData.name);
            }
          }
        }
        cursor = response.cursor;
      } while (cursor);

      logger.debug(`Loaded ${this.categories.size} categories from Square`);

      // Then load all items (products)
      cursor = null;
      do {
        const params = { types: ['ITEM'], limit: 100 };
        if (cursor) params.cursor = cursor;

        const response = await this.client.catalog.list(params);

        if (response.objects) {
          for (const obj of response.objects) {
            if (obj.type === 'ITEM' && obj.itemData) {
              const categoryId = obj.itemData.categoryId || obj.itemData.reportingCategory?.id;
              const categoryName = categoryId ? this.categories.get(categoryId) : null;

              // Store the item info
              this.catalogItems.set(obj.id, {
                name: obj.itemData.name,
                categoryId: categoryId,
                categoryName: categoryName,
                description: obj.itemData.description || ''
              });

              // Also store each variation (these are what appear in orders)
              if (obj.itemData.variations) {
                for (const variation of obj.itemData.variations) {
                  this.catalogItems.set(variation.id, {
                    name: obj.itemData.name,
                    variationName: variation.itemVariationData?.name,
                    categoryId: categoryId,
                    categoryName: categoryName,
                    sku: variation.itemVariationData?.sku || '',
                    description: obj.itemData.description || ''
                  });
                }
              }
            }
          }
        }
        cursor = response.cursor;
      } while (cursor);

      logger.info(`Loaded ${this.catalogItems.size} catalog items from Square`);
    } catch (error) {
      logger.warn(`Could not load Square catalog: ${error.message}`);
      // Non-fatal - we can still process payments without catalog info
    }
  }

  /**
   * Fetch payments from Square within the given date range
   * @param {string} dateFrom - Start date (YYYY-MM-DD)
   * @param {string} dateTo - End date (YYYY-MM-DD)
   * @returns {Promise<Array>} Normalized transactions
   */
  async getTransactions(dateFrom, dateTo) {
    // Load catalog first to get category info
    await this.loadCatalog();

    logger.info(`Fetching Square payments (${dateFrom} to ${dateTo})...`);

    const payments = [];
    let cursor = null;

    try {
      // Convert dates to RFC 3339 format for Square API
      const beginTime = `${dateFrom}T00:00:00Z`;
      const endTime = `${dateTo}T23:59:59Z`;

      do {
        const listParams = {
          beginTime,
          endTime,
          sortOrder: 'ASC',
          limit: 100
        };

        // Filter by location if specified
        if (this.locationId) {
          listParams.locationId = this.locationId;
        }

        if (cursor) {
          listParams.cursor = cursor;
        }

        const response = await this.client.payments.list(listParams);

        if (response.payments) {
          // Only include completed payments
          const completedPayments = response.payments.filter(p => p.status === 'COMPLETED');
          payments.push(...completedPayments);
          logger.debug(`Fetched ${completedPayments.length} completed payments from Square`);
        }

        cursor = response.cursor;
      } while (cursor);

      logger.info(`Fetched ${payments.length} payments from Square`);

      // Fetch order details for payments that have an orderId
      const normalizedTransactions = [];

      for (const payment of payments) {
        let order = null;

        if (payment.orderId) {
          try {
            const orderResponse = await this.client.orders.retrieve({
              orderId: payment.orderId
            });
            order = orderResponse.order;
          } catch (err) {
            logger.warn(`Could not fetch order ${payment.orderId} for payment ${payment.id}: ${err.message}`);
          }
        }

        normalizedTransactions.push(this.normalizeTransaction(payment, order));
      }

      return normalizedTransactions;
    } catch (error) {
      if (error.statusCode === 401) {
        logger.error('Square authentication failed. Check your access token.');
      } else if (error.statusCode === 429) {
        logger.error('Square rate limit exceeded. Try again later.');
      } else {
        logger.error(`Error fetching Square payments: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Normalize a Square payment (and optional order) to standard format
   * @param {Object} payment - Square payment object
   * @param {Object|null} order - Square order object (if available)
   * @returns {Object} Normalized transaction
   */
  normalizeTransaction(payment, order = null) {
    // Convert Square's money amounts (in smallest currency unit, e.g., cents) to decimal
    const amount = this.convertMoney(payment.amountMoney);
    const tip = this.convertMoney(payment.tipMoney);
    const fee = this.convertMoney(payment.processingFee?.[0]?.amountMoney);

    // Build line items from order if available, otherwise single item from payment
    let items;

    if (order && order.lineItems && order.lineItems.length > 0) {
      items = order.lineItems.map(item => this.normalizeLineItem(item));
    } else {
      // No order details - create single line item from payment total
      const netAmount = amount - tip;
      // For payments without order details, VAT will be determined by Holded product or default
      items = [{
        sku: `SQUARE-${payment.id.substring(0, 12)}`,
        name: payment.note || 'Square POS Sale',
        description: '',
        quantity: 1,
        price: netAmount,
        total: netAmount,
        totalWithTax: netAmount,
        tax: 0,  // Will be calculated by Holded based on product VAT
        taxRate: null,  // Let Holded determine from product
        category: null
      }];
    }

    // Extract customer info if available
    let customer = null;
    if (payment.buyerEmailAddress || order?.customerId) {
      customer = {
        email: payment.buyerEmailAddress || '',
        name: order?.customerId ? `Square Customer ${order.customerId.substring(0, 8)}` : '',
        phone: ''
      };
    }

    // Calculate totals from items
    const totalWithTax = items.reduce((sum, item) => sum + (item.totalWithTax || item.total), 0);
    const totalTax = items.reduce((sum, item) => sum + (item.tax || 0), 0);

    return {
      source: 'square',
      sitePrefix: 'SQUARE',
      siteName: 'Square',
      id: payment.id,
      orderNumber: payment.receiptNumber || payment.id.substring(0, 12),
      transactionCode: payment.id,
      date: payment.createdAt,
      total: totalWithTax + tip,
      subtotal: totalWithTax - totalTax,
      tax: totalTax,
      currency: payment.amountMoney?.currency || 'EUR',
      status: payment.status,
      paymentMethod: 'Square Balance',  // Matches Holded payment method name
      paymentType: this.getPaymentType(payment),
      cardBrand: payment.cardDetails?.card?.cardBrand,
      cardLast4: payment.cardDetails?.card?.last4,
      tip: tip,
      fee: fee,
      customer: customer,
      items: items,
      paid: payment.status === 'COMPLETED',
      metadata: {
        squarePaymentId: payment.id,
        squareOrderId: payment.orderId,
        squareLocationId: payment.locationId,
        receiptUrl: payment.receiptUrl
      }
    };
  }

  /**
   * Normalize a Square order line item
   * @param {Object} item - Square order line item
   * @returns {Object} Normalized line item
   */
  normalizeLineItem(item) {
    const quantity = parseFloat(item.quantity) || 1;

    // Square stores amounts in smallest currency unit (cents)
    const totalWithTax = this.convertMoney(item.grossSalesMoney) ||
                         this.convertMoney(item.totalMoney) || 0;

    // Get tax from item if available
    const tax = this.convertMoney(item.totalTaxMoney) || 0;
    const total = totalWithTax - tax;

    // Calculate price per unit
    const pricePerUnit = quantity > 0 ? total / quantity : total;

    // Look up catalog info for this item
    const catalogInfo = item.catalogObjectId
      ? this.catalogItems.get(item.catalogObjectId)
      : null;

    // Get SKU - prefer catalog SKU, then generate from catalog ID or item name
    let sku = '';
    if (catalogInfo?.sku) {
      sku = catalogInfo.sku;
    } else if (item.catalogObjectId) {
      sku = `SQUARE-${item.catalogObjectId.substring(0, 12)}`;
    } else if (item.variationName) {
      sku = `SQUARE-${item.variationName.replace(/\s+/g, '-').substring(0, 20)}`;
    } else {
      sku = `SQUARE-${item.uid || 'ITEM'}`;
    }

    // Get category from catalog
    const category = catalogInfo?.categoryName || null;

    // Determine tax rate from the actual tax on this item
    // This will be overridden by Holded product's VAT if the product exists
    let taxRate = null;
    if (total > 0 && tax > 0) {
      taxRate = Math.round((tax / total) * 100);
    }

    return {
      sku: sku,
      name: item.name || catalogInfo?.name || 'Square Item',
      description: item.variationName || catalogInfo?.variationName || item.note || '',
      quantity: quantity,
      price: pricePerUnit,
      total: total,
      totalWithTax: totalWithTax,
      tax: tax,
      taxRate: taxRate,  // Will be overridden by Holded product VAT if available
      discount: this.convertMoney(item.totalDiscountMoney) || 0,
      // Category info for account mapping
      category: category,
      catalogObjectId: item.catalogObjectId
    };
  }

  /**
   * Convert Square money object to decimal number
   * Square stores money in smallest currency unit (e.g., cents)
   * @param {Object} money - Square money object { amount, currency }
   * @returns {number} Decimal amount
   */
  convertMoney(money) {
    if (!money || !money.amount) return 0;
    // Square amounts are in cents (or smallest unit), convert to main unit
    return parseInt(money.amount, 10) / 100;
  }

  /**
   * Get human-readable payment type from Square payment details
   * @param {Object} payment - Square payment object
   * @returns {string} Payment type
   */
  getPaymentType(payment) {
    if (payment.cardDetails) {
      return `Card (${payment.cardDetails.card?.cardBrand || 'Unknown'})`;
    }
    if (payment.cashDetails) {
      return 'Cash';
    }
    if (payment.bankAccountDetails) {
      return 'Bank Transfer';
    }
    if (payment.externalDetails) {
      return payment.externalDetails.type || 'External';
    }
    return 'Square';
  }
}

/**
 * Fetch Square transactions for the given date range
 * @param {string} dateFrom - Start date (YYYY-MM-DD)
 * @param {string} dateTo - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Normalized transactions
 */
export async function fetchSquareTransactions(dateFrom, dateTo) {
  if (!config.square.accessToken) {
    logger.warn('Square access token not configured, skipping...');
    return [];
  }

  try {
    const client = new SquareSource();
    return await client.getTransactions(dateFrom, dateTo);
  } catch (error) {
    logger.error(`Square fetch failed: ${error.message}`);
    return [];
  }
}
