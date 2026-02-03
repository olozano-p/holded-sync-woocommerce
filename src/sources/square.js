import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class SquareSource {
  constructor() {
    this.client = axios.create({
      baseURL: 'https://connect.squareup.com/v2',
      headers: {
        'Authorization': `Bearer ${config.square.accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18'
      }
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
        const params = { types: 'CATEGORY', limit: 100 };
        if (cursor) params.cursor = cursor;

        const response = await this.client.get('/catalog/list', { params });
        const objects = response.data.objects || [];

        for (const obj of objects) {
          if (obj.type === 'CATEGORY' && obj.category_data) {
            this.categories.set(obj.id, obj.category_data.name);
          }
        }
        cursor = response.data.cursor;
      } while (cursor);

      logger.debug(`Loaded ${this.categories.size} categories from Square`);

      // Then load all items (products)
      cursor = null;
      do {
        const params = { types: 'ITEM', limit: 100 };
        if (cursor) params.cursor = cursor;

        const response = await this.client.get('/catalog/list', { params });
        const objects = response.data.objects || [];

        for (const obj of objects) {
          const itemData = obj.item_data;
          if (obj.type === 'ITEM' && itemData) {
            const categoryId = itemData.category_id || itemData.reporting_category?.id;
            const categoryName = categoryId ? this.categories.get(categoryId) : null;

            // Store the item info
            this.catalogItems.set(obj.id, {
              name: itemData.name,
              categoryId: categoryId,
              categoryName: categoryName,
              description: itemData.description || ''
            });

            // Also store each variation (these are what appear in orders)
            if (itemData.variations) {
              for (const variation of itemData.variations) {
                const variationData = variation.item_variation_data;
                this.catalogItems.set(variation.id, {
                  name: itemData.name,
                  variationName: variationData?.name,
                  categoryId: categoryId,
                  categoryName: categoryName,
                  sku: variationData?.sku || '',
                  description: itemData.description || ''
                });
              }
            }
          }
        }
        cursor = response.data.cursor;
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
        const params = {
          begin_time: beginTime,
          end_time: endTime,
          sort_order: 'ASC',
          limit: 100
        };

        // Filter by location if specified
        if (this.locationId) {
          params.location_id = this.locationId;
        }

        if (cursor) {
          params.cursor = cursor;
        }

        const response = await this.client.get('/payments', { params });
        const items = response.data.payments || [];

        // Only include completed payments
        const completedPayments = items.filter(p => p.status === 'COMPLETED');
        payments.push(...completedPayments);
        logger.debug(`Fetched ${completedPayments.length} completed payments from Square`);

        cursor = response.data.cursor;
      } while (cursor);

      logger.info(`Fetched ${payments.length} payments from Square`);

      // Fetch order details for payments that have an order_id
      const normalizedTransactions = [];

      for (const payment of payments) {
        let order = null;

        if (payment.order_id) {
          try {
            const orderResponse = await this.client.get(`/orders/${payment.order_id}`);
            order = orderResponse.data.order;
          } catch (err) {
            logger.warn(`Could not fetch order ${payment.order_id} for payment ${payment.id}: ${err.message}`);
          }
        }

        normalizedTransactions.push(this.normalizeTransaction(payment, order));
      }

      return normalizedTransactions;
    } catch (error) {
      if (error.response?.status === 401) {
        logger.error('Square authentication failed. Check your access token.');
      } else if (error.response?.status === 429) {
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
    const amount = this.convertMoney(payment.amount_money);
    const tip = this.convertMoney(payment.tip_money);
    const fee = this.convertMoney(payment.processing_fee?.[0]?.amount_money);

    // Build line items from order if available, otherwise single item from payment
    let items;

    const lineItems = order?.line_items || [];
    // Build a map of tax_uid -> percentage from order's taxes array
    const taxRates = new Map();
    if (order?.taxes) {
      for (const tax of order.taxes) {
        if (tax.uid && tax.percentage) {
          taxRates.set(tax.uid, parseFloat(tax.percentage));
        }
      }
    }

    if (order && lineItems.length > 0) {
      items = lineItems.map(item => this.normalizeLineItem(item, taxRates));
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
    const buyerEmail = payment.buyer_email_address;
    const customerId = order?.customer_id;
    if (buyerEmail || customerId) {
      customer = {
        email: buyerEmail || '',
        name: customerId ? `Square Customer ${customerId.substring(0, 8)}` : '',
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
      orderNumber: payment.receipt_number || payment.id.substring(0, 12),
      transactionCode: payment.id,
      date: payment.created_at,
      total: totalWithTax + tip,
      subtotal: totalWithTax - totalTax,
      tax: totalTax,
      currency: payment.amount_money?.currency || 'EUR',
      status: payment.status,
      paymentMethod: this.getHoldedPaymentMethod(payment),  // Maps to correct Holded payment account
      paymentType: this.getPaymentType(payment),
      cardBrand: payment.card_details?.card?.card_brand,
      cardLast4: payment.card_details?.card?.last_4,
      tip: tip,
      fee: fee,
      customer: customer,
      items: items,
      paid: payment.status === 'COMPLETED',
      metadata: {
        squarePaymentId: payment.id,
        squareOrderId: payment.order_id,
        squareLocationId: payment.location_id,
        receiptUrl: payment.receipt_url
      }
    };
  }

  /**
   * Normalize a Square order line item
   * @param {Object} item - Square order line item
   * @param {Map} taxRates - Map of tax_uid -> percentage from order's taxes array
   * @returns {Object} Normalized line item
   */
  normalizeLineItem(item, taxRates = new Map()) {
    const quantity = parseFloat(item.quantity) || 1;

    // Square stores amounts in smallest currency unit (cents)
    // gross_sales_money = base_price × quantity (BEFORE discounts and taxes)
    // total_discount_money = discount amount
    // total_tax_money = tax amount
    // total_money = final amount (gross - discount + tax)
    const grossSales = this.convertMoney(item.gross_sales_money) || 0;
    const totalDiscount = this.convertMoney(item.total_discount_money) || 0;
    const tax = this.convertMoney(item.total_tax_money) || 0;
    const totalWithTax = this.convertMoney(item.total_money) || 0;

    // Net amount after discount, before tax
    const total = grossSales - totalDiscount;

    // Calculate price per unit (before discount)
    const pricePerUnit = quantity > 0 ? grossSales / quantity : grossSales;

    // Look up catalog info for this item
    const catalogObjectId = item.catalog_object_id;
    const catalogInfo = catalogObjectId
      ? this.catalogItems.get(catalogObjectId)
      : null;

    // Debug logging
    logger.debug(`Line item "${item.name}" - catalog_object_id: ${catalogObjectId}, found in catalog: ${!!catalogInfo}, category: ${catalogInfo?.categoryName || 'null'}`);

    // Get SKU - prefer catalog SKU, then generate from catalog ID or item name
    let sku = '';
    const variationName = item.variation_name;
    if (catalogInfo?.sku) {
      sku = catalogInfo.sku;
    } else if (catalogObjectId) {
      sku = `SQUARE-${catalogObjectId.substring(0, 12)}`;
    } else if (variationName) {
      sku = `SQUARE-${variationName.replace(/\s+/g, '-').substring(0, 20)}`;
    } else {
      sku = `SQUARE-${item.uid || 'ITEM'}`;
    }

    // Get category from catalog
    const category = catalogInfo?.categoryName || null;

    // Get tax rate from applied_taxes (the actual tax percentage configured in Square)
    let taxRate = null;
    if (item.applied_taxes && item.applied_taxes.length > 0) {
      // Get the tax_uid from the first applied tax and look up the percentage
      const appliedTax = item.applied_taxes[0];
      if (appliedTax.tax_uid && taxRates.has(appliedTax.tax_uid)) {
        taxRate = taxRates.get(appliedTax.tax_uid);
        logger.debug(`Tax rate for "${item.name}": ${taxRate}% (from Square tax config)`);
      }
    }
    // Fallback: calculate from amounts if no applied_taxes
    if (taxRate === null && total > 0 && tax > 0) {
      taxRate = Math.round((tax / total) * 100);
      logger.debug(`Tax rate for "${item.name}": ${taxRate}% (calculated from amounts)`);
    }

    return {
      sku: sku,
      name: item.name || catalogInfo?.name || 'Square Item',
      description: variationName || catalogInfo?.variationName || item.note || '',
      quantity: quantity,
      price: pricePerUnit,  // Unit price before discount
      grossSales: grossSales,  // Total before discount (price × quantity)
      total: total,  // After discount, before tax
      totalWithTax: totalWithTax,  // Final amount including tax
      tax: tax,
      taxRate: taxRate,  // Will be overridden by Holded product VAT if available
      discount: totalDiscount,  // Discount amount in currency
      // Category info for account mapping
      category: category,
      catalogObjectId: catalogObjectId
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
    if (payment.card_details) {
      return `Card (${payment.card_details.card?.card_brand || 'Unknown'})`;
    }
    if (payment.cash_details) {
      return 'Cash';
    }
    if (payment.bank_account_details) {
      return 'Bank Transfer';
    }
    if (payment.external_details) {
      return payment.external_details.type || 'External';
    }
    if (payment.source_type === 'SQUARE_ACCOUNT') {
      return 'Square Account';
    }
    return 'Square';
  }

  /**
   * Get the Holded payment method name based on Square payment type
   * Maps Square payment types to Holded payment accounts:
   * - Card/Wallet/Buy Now Pay Later → "Square Balance" (settled to Square)
   * - Cash payments → "Square Cash Clearing"
   * - Bank/External payments → "Square Other Payments Clearing"
   * @param {Object} payment - Square payment object
   * @returns {string} Holded payment method name
   */
  getHoldedPaymentMethod(payment) {
    // Cash payments go to cash clearing
    if (payment.cash_details) {
      return 'Square Cash Clearing';
    }
    // Bank transfers and external payments go to other clearing
    if (payment.bank_account_details || payment.external_details) {
      return 'Square Other Payments Clearing';
    }
    // Everything else (card, wallet, buy now pay later) goes to Square Balance
    // This includes: card_details, wallet_details, buy_now_pay_later_details
    return 'Square Balance';
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
