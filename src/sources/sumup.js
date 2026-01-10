import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class SumUpClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.sumup.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.sumup.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async getTransactions(dateFrom, dateTo) {
    logger.info(`Fetching SumUp transactions (${dateFrom} to ${dateTo})...`);
    const transactions = [];
    let hasMore = true;
    let oldestTime = null;

    while (hasMore) {
      try {
        const params = {
          limit: 100,
          oldest_time: dateFrom + 'T00:00:00Z',
          newest_time: dateTo + 'T23:59:59Z',
          statuses: ['SUCCESSFUL']
        };

        if (oldestTime) {
          params.oldest_ref = oldestTime;
        }

        const response = await this.client.get('/me/transactions/history', { params });
        const items = response.data.items || [];
        
        transactions.push(...items);
        
        // Check for pagination
        hasMore = items.length === 100;
        if (hasMore && items.length > 0) {
          oldestTime = items[items.length - 1].id;
        }
        
        logger.debug(`Fetched ${items.length} transactions from SumUp`);
      } catch (error) {
        if (error.response?.status === 401) {
          logger.error('SumUp authentication failed. Check your API key.');
        } else {
          logger.error(`Error fetching SumUp transactions: ${error.message}`);
        }
        throw error;
      }
    }

    logger.info(`Fetched ${transactions.length} transactions from SumUp`);
    return transactions.map(t => this.normalizeTransaction(t));
  }

  normalizeTransaction(tx) {
    return {
      source: 'sumup',
      id: tx.id,
      transactionCode: tx.transaction_code,
      date: tx.timestamp,
      amount: tx.amount,
      currency: tx.currency,
      status: tx.status,
      paymentType: tx.payment_type,
      cardType: tx.card?.type,
      tip: tx.tip_amount || 0,
      vat: tx.vat_amount || 0,
      productSummary: tx.product_summary || 'SumUp Sale',
      // SumUp doesn't provide detailed line items in basic API
      // The amount is the total
      items: [{
        sku: `SUMUP-${tx.transaction_code}`,
        name: tx.product_summary || 'Point of Sale',
        quantity: 1,
        price: tx.amount - (tx.tip_amount || 0) - (tx.vat_amount || 0),
        total: tx.amount - (tx.tip_amount || 0) - (tx.vat_amount || 0),
        totalWithTax: tx.amount - (tx.tip_amount || 0),
        tax: tx.vat_amount || 0
      }]
    };
  }
}

export async function fetchSumUpTransactions(dateFrom, dateTo) {
  if (!config.sumup.apiKey) {
    logger.warn('SumUp API key not configured, skipping...');
    return [];
  }
  
  try {
    const client = new SumUpClient();
    return await client.getTransactions(dateFrom, dateTo);
  } catch (error) {
    logger.error(`SumUp fetch failed: ${error.message}`);
    return [];
  }
}
