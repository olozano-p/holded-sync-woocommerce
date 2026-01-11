import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export class WooCommerceClient {
  constructor(siteConfig) {
    this.name = siteConfig.name;
    this.prefix = siteConfig.prefix;
    this.pricesIncludeTax = siteConfig.pricesIncludeTax || false;
    this.defaultVatRate = siteConfig.defaultVatRate || 21;
    this.wpmlLang = siteConfig.wpmlLang || '';
    this.api = new WooCommerceRestApi.default({
      url: siteConfig.url,
      consumerKey: siteConfig.consumerKey,
      consumerSecret: siteConfig.consumerSecret,
      version: 'wc/v3'
    });
  }

  async getAllProducts() {
    logger.info(`Fetching products from ${this.name}${this.wpmlLang ? ` (lang=${this.wpmlLang})` : ''}...`);
    const products = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const params = {
          per_page: 100,
          page,
          status: 'publish'
        };
        // WPML support: add lang parameter for multilingual sites
        if (this.wpmlLang) {
          params.lang = this.wpmlLang;
        }
        const response = await this.api.get('products', params);
        
        products.push(...response.data);
        
        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1');
        hasMore = page < totalPages;
        page++;
        
      } catch (error) {
        logger.error(`Error fetching products from ${this.name}: ${error.message}`);
        throw error;
      }
    }

    logger.info(`Fetched ${products.length} products from ${this.name}`);

    // Process products in batches to prevent stack overflow
    const normalizedProducts = [];
    const batchSize = 100;

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      try {
        const normalizedBatch = batch.map(p => this.normalizeProduct(p));
        normalizedProducts.push(...normalizedBatch);
      } catch (error) {
        logger.error(`Error normalizing product batch ${Math.floor(i/batchSize) + 1} from ${this.name}: ${error.message}`);
        // Continue with remaining batches instead of failing completely
      }
    }

    return normalizedProducts;
  }

  async getOrders(dateFrom, dateTo) {
    logger.info(`Fetching orders from ${this.name} (${dateFrom} to ${dateTo})${this.wpmlLang ? ` (lang=${this.wpmlLang})` : ''}...`);
    const orders = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 1000; // Safety limit to prevent infinite loops

    while (hasMore && page <= maxPages) {
      try {
        const params = {
          per_page: 100,
          page,
          after: `${dateFrom}T00:00:00`,
          before: `${dateTo}T23:59:59`,
          status: ['completed', 'processing']
        };
        // WPML support: add lang parameter for multilingual sites
        if (this.wpmlLang) {
          params.lang = this.wpmlLang;
        }
        const response = await this.api.get('orders', params);

        // Break if no data returned
        if (!response.data || response.data.length === 0) {
          break;
        }

        orders.push(...response.data);

        const totalPagesHeader = response.headers['x-wp-totalpages'];
        const totalPages = totalPagesHeader ? parseInt(totalPagesHeader) : 1;


        // Safety checks for totalPages
        if (isNaN(totalPages) || totalPages <= 0 || totalPages > maxPages) {
          logger.warn(`Invalid totalPages (${totalPagesHeader}) from ${this.name}, stopping pagination`);
          break;
        }

        hasMore = page < totalPages;
        page++;
      } catch (error) {
        logger.error(`Error fetching orders from ${this.name}: ${error.message}`);
        throw error;
      }
    }

    if (page > maxPages) {
      logger.warn(`Hit maximum pages limit (${maxPages}) for ${this.name}`);
    }

    logger.info(`Fetched ${orders.length} orders from ${this.name}`);

    // Process orders in batches to prevent stack overflow
    const normalizedOrders = [];
    const batchSize = 50;

    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);
      try {
        const normalizedBatch = batch.map(o => this.normalizeOrder(o));
        normalizedOrders.push(...normalizedBatch);
      } catch (error) {
        logger.error(`Error normalizing order batch ${Math.floor(i/batchSize) + 1} from ${this.name}: ${error.message}`);
        // Continue with remaining batches instead of failing completely
      }
    }

    return normalizedOrders;
  }

  normalizeProduct(wcProduct) {
    return {
      source: 'woocommerce',
      sitePrefix: this.prefix,
      siteName: this.name,
      id: wcProduct.id,
      sku: wcProduct.sku || `${this.prefix}-${wcProduct.id}`,
      name: wcProduct.name,
      description: this.stripHtml(wcProduct.short_description || wcProduct.description || ''),
      price: parseFloat(wcProduct.price) || 0,
      regularPrice: parseFloat(wcProduct.regular_price) || 0,
      salePrice: parseFloat(wcProduct.sale_price) || 0,
      // Pass flag so Holded client can calculate net price using product's actual VAT rate
      pricesIncludeTax: this.pricesIncludeTax,
      defaultVatRate: this.defaultVatRate,
      categories: wcProduct.categories?.map(c => c.name) || [],
      tags: wcProduct.tags?.map(t => t.name) || [],
      stock: wcProduct.stock_quantity || 0,
      manageStock: wcProduct.manage_stock,
      taxClass: wcProduct.tax_class,
      weight: parseFloat(wcProduct.weight) || 0
    };
  }

  normalizeOrder(wcOrder) {
    return {
      source: 'woocommerce',
      sitePrefix: this.prefix,
      siteName: this.name,
      id: wcOrder.id,
      orderNumber: wcOrder.number,
      status: wcOrder.status,
      date: wcOrder.date_created,
      total: parseFloat(wcOrder.total),
      subtotal: parseFloat(wcOrder.total) - parseFloat(wcOrder.total_tax || 0),
      tax: parseFloat(wcOrder.total_tax) || 0,
      currency: wcOrder.currency,
      paymentMethod: wcOrder.payment_method_title,
      customer: {
        name: `${wcOrder.billing?.first_name || ''} ${wcOrder.billing?.last_name || ''}`.trim() || 'Cliente',
        email: wcOrder.billing?.email || '',
        phone: wcOrder.billing?.phone || '',
        company: wcOrder.billing?.company || '',
        // DNI (Spanish personal ID) - goes to Holded's 'code' field (client ID)
        dni: (wcOrder.meta_data?.find(m => m.key === '_billing_dni')?.value || '').toUpperCase(),
        // VAT/NIF for businesses - goes to Holded's 'vatnumber' field
        vatNumber: wcOrder.meta_data?.find(m =>
          m.key === '_billing_vat' ||
          m.key === '_billing_nif' ||
          m.key === 'billing_vat' ||
          m.key === '_vat_number'
        )?.value || '',
        // Full address for Holded
        address: [
          wcOrder.billing?.address_1,
          wcOrder.billing?.address_2
        ].filter(Boolean).join(', '),
        city: wcOrder.billing?.city || '',
        postalCode: wcOrder.billing?.postcode || '',
        province: wcOrder.billing?.state || '',
        country: wcOrder.billing?.country || 'ES',
        countryName: this.getCountryName(wcOrder.billing?.country)
      },
      items: wcOrder.line_items?.map(item => ({
        sku: item.sku || `${this.prefix}-${item.product_id}`,
        name: item.name,
        description: '',
        quantity: item.quantity,
        price: parseFloat(item.price),  // Unit price without tax (WooCommerce calculated)
        total: parseFloat(item.total),  // Line total without tax
        totalWithTax: parseFloat(item.total) + parseFloat(item.total_tax || 0), // Line total WITH tax
        tax: parseFloat(item.total_tax) || 0,
        taxRate: this.calculateTaxRate(item),
        discount: 0
      })) || [],
      // Mark as unpaid - payments will be synced separately from bank accounts
      paid: false
    };
  }

  calculateTaxRate(item) {
    // Calculate effective tax rate from item
    const subtotal = parseFloat(item.total) || 0;
    const tax = parseFloat(item.total_tax) || 0;
    if (subtotal > 0 && tax > 0) {
      return Math.round((tax / subtotal) * 100);
    }
    return config.sync.defaultVatRate;
  }

  getCountryName(code) {
    const countries = {
      'ES': 'España',
      'FR': 'Francia',
      'DE': 'Alemania',
      'IT': 'Italia',
      'PT': 'Portugal',
      'GB': 'Reino Unido',
      'US': 'Estados Unidos'
    };
    return countries[code] || code || 'España';
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').trim().substring(0, 500);
  }
}

export async function fetchAllWooCommerceProducts(sites) {
  const allProducts = [];
  
  for (const site of sites) {
    try {
      const client = new WooCommerceClient(site);
      const products = await client.getAllProducts();
      allProducts.push(...products);
    } catch (error) {
      logger.error(`Failed to fetch from ${site.name}: ${error.message}`);
    }
  }
  
  return allProducts;
}

export async function fetchAllWooCommerceOrders(sites, dateFrom, dateTo) {
  const allOrders = [];
  
  for (const site of sites) {
    try {
      const client = new WooCommerceClient(site);
      const orders = await client.getOrders(dateFrom, dateTo);
      allOrders.push(...orders);
    } catch (error) {
      logger.error(`Failed to fetch orders from ${site.name}: ${error.message}`);
    }
  }
  
  return allOrders;
}
