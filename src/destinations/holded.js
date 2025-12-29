import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class HoldedClient {
  constructor() {
    this.client = axios.create({
      baseURL: config.holded.baseUrl,
      headers: {
        'key': config.holded.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    this.existingProducts = new Map(); // sku -> { id, ... }
    this.existingContacts = new Map(); // email/name -> id
    this.salesChannels = new Map();    // name -> id
    this.warehouses = new Map();       // name -> id
    this.paymentMethods = new Map();   // name -> id
  }

  // ============================================
  // INITIALIZATION - Load existing data
  // ============================================

  async initialize() {
    await Promise.all([
      this.loadExistingProducts(),
      this.loadSalesChannels(),
      this.loadWarehouses(),
      this.loadPaymentMethods()
    ]);
  }

  async loadExistingProducts() {
    logger.info('Loading existing products from Holded...');
    try {
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        const response = await this.client.get('/products', { params: { page } });
        const products = response.data || [];
        
        products.forEach(p => {
          if (p.sku) {
            this.existingProducts.set(p.sku, { id: p.id, ...p });
          }
        });
        
        hasMore = products.length === 50; // Holded default page size
        page++;
      }
      
      logger.info(`Loaded ${this.existingProducts.size} existing products`);
    } catch (error) {
      logger.error(`Failed to load existing products: ${error.message}`);
    }
  }

  async loadSalesChannels() {
    try {
      const response = await this.client.get('/saleschannels');
      (response.data || []).forEach(ch => {
        this.salesChannels.set(ch.name, ch.id);
      });
      logger.debug(`Loaded ${this.salesChannels.size} sales channels`);
    } catch (error) {
      logger.warn(`Failed to load sales channels: ${error.message}`);
    }
  }

  async loadWarehouses() {
    try {
      const response = await this.client.get('/warehouses');
      (response.data || []).forEach(wh => {
        this.warehouses.set(wh.name, wh.id);
      });
      logger.debug(`Loaded ${this.warehouses.size} warehouses`);
    } catch (error) {
      logger.warn(`Failed to load warehouses: ${error.message}`);
    }
  }

  async loadPaymentMethods() {
    try {
      const response = await this.client.get('/paymentmethods');
      (response.data || []).forEach(pm => {
        this.paymentMethods.set(pm.name?.toLowerCase(), pm.id);
      });
      logger.debug(`Loaded ${this.paymentMethods.size} payment methods`);
    } catch (error) {
      logger.warn(`Failed to load payment methods: ${error.message}`);
    }
  }

  // ============================================
  // PRODUCTS
  // ============================================

  async createOrUpdateProduct(product) {
    const existingId = this.existingProducts.get(product.sku)?.id;
    
    // Holded product structure per API docs
    const holdedProduct = {
      name: product.name,
      sku: product.sku,
      desc: product.description || '',
      price: product.price,           // Precio venta (subtotal sin IVA)
      tax: config.sync.defaultVatRate,
      purchasePrice: product.cost || 0,
      stock: product.stock || 0,
      tags: product.tags || [],
      kind: 'simple'                  // simple, variants, lots, pack
    };

    try {
      if (existingId) {
        await this.client.put(`/products/${existingId}`, holdedProduct);
        logger.debug(`Updated product: ${product.sku}`);
        return { action: 'updated', sku: product.sku };
      } else {
        const response = await this.client.post('/products', holdedProduct);
        this.existingProducts.set(product.sku, { id: response.data.id });
        logger.debug(`Created product: ${product.sku}`);
        return { action: 'created', sku: product.sku };
      }
    } catch (error) {
      logger.error(`Failed to sync product ${product.sku}: ${error.message}`);
      if (error.response?.data) {
        logger.error(`API response: ${JSON.stringify(error.response.data)}`);
      }
      return { action: 'error', sku: product.sku, error: error.message };
    }
  }

  async syncProducts(products) {
    await this.loadExistingProducts();
    
    const results = { created: 0, updated: 0, errors: 0 };
    
    for (const product of products) {
      const result = await this.createOrUpdateProduct(product);
      results[result.action === 'error' ? 'errors' : result.action]++;
      
      // Rate limiting - Holded doesn't document limits, be conservative
      await this.sleep(100);
    }
    
    logger.info(`Product sync complete: ${results.created} created, ${results.updated} updated, ${results.errors} errors`);
    return results;
  }

  // ============================================
  // CONTACTS
  // ============================================

  async findOrCreateContact(customer) {
    if (!customer || (!customer.name && !customer.email)) {
      return null; // Generic/anonymous customer
    }
    
    const key = customer.email || customer.name;
    
    if (this.existingContacts.has(key)) {
      return this.existingContacts.get(key);
    }

    try {
      // Search for existing contact by email or NIF
      const searchParams = customer.vatNumber 
        ? { vatnumber: customer.vatNumber }
        : { email: customer.email };
      
      const searchResponse = await this.client.get('/contacts', { params: searchParams });
      
      const existing = (searchResponse.data || []).find(c => 
        c.email === customer.email || 
        c.name === customer.name ||
        c.vatnumber === customer.vatNumber
      );
      
      if (existing) {
        this.existingContacts.set(key, existing.id);
        return existing.id;
      }
      
      // Create new contact
      const newContact = {
        name: customer.name || customer.email || 'Cliente',
        email: customer.email || '',
        phone: customer.phone || '',
        tradeName: customer.company || '',
        vatnumber: customer.vatNumber || '',
        type: 'client',
        // Address fields
        address: customer.address || '',
        city: customer.city || '',
        postalCode: customer.postalCode || '',
        province: customer.province || '',
        country: customer.country || 'ES',
        countryName: customer.countryName || 'España'
      };
      
      const createResponse = await this.client.post('/contacts', newContact);
      const contactId = createResponse.data?.id;
      
      if (contactId) {
        this.existingContacts.set(key, contactId);
        logger.debug(`Created contact: ${customer.name || customer.email}`);
      }
      
      return contactId;
    } catch (error) {
      logger.warn(`Failed to create contact for ${customer.name}: ${error.message}`);
      return null;
    }
  }

  // ============================================
  // INVOICES / DOCUMENTS
  // ============================================

  /**
   * Create invoice in Holded
   * docType options: invoice, salesreceipt, creditnote, salesorder, proform, waybill, estimate
   */
  async createInvoice(order, docType = 'invoice') {
    const contactId = order.customer 
      ? await this.findOrCreateContact(order.customer) 
      : null;
    
    // Build invoice data per Holded API spec
    // Reference: https://developers.holded.com/reference/create-document-1
    const invoiceData = {
      // Contact - can use contactId or contactCode (NIF)
      ...(contactId && { contactId }),
      ...(order.customer?.vatNumber && !contactId && { contactCode: order.customer.vatNumber }),
      
      // If no contact, provide inline contact info
      ...(!contactId && order.customer && {
        contactName: order.customer.name || 'Cliente',
        contactEmail: order.customer.email || '',
        contactAddress: order.customer.address || '',
        contactCity: order.customer.city || '',
        contactCp: order.customer.postalCode || '',
        contactProvince: order.customer.province || '',
        contactCountry: order.customer.country || 'ES',
        contactCountryName: order.customer.countryName || 'España'
      }),
      
      // Document metadata
      desc: `${order.source.toUpperCase()} - ${order.siteName || 'SumUp'} #${order.orderNumber || order.transactionCode || order.id}`,
      date: Math.floor(new Date(order.date).getTime() / 1000), // Unix timestamp
      
      // Due date (same as date for immediate payment)
      dueDate: Math.floor(new Date(order.date).getTime() / 1000),
      
      // Currency
      currency: order.currency || 'EUR',
      
      // Line items - THIS IS THE KEY STRUCTURE
      items: order.items.map(item => ({
        name: item.name,
        desc: item.description || '',
        sku: item.sku || '',
        units: item.quantity || 1,
        subtotal: item.price,      // Price per unit WITHOUT tax
        discount: item.discount || 0,
        tax: item.taxRate || config.sync.defaultVatRate
      })),
      
      // Tags for filtering
      tags: [
        order.source,
        order.sitePrefix,
        order.paymentMethod || order.paymentType
      ].filter(Boolean),
      
      // Sales channel (if configured)
      ...(order.salesChannel && this.salesChannels.has(order.salesChannel) && {
        salesChannel: this.salesChannels.get(order.salesChannel)
      }),
      
      // Warehouse (if configured) 
      ...(order.warehouse && this.warehouses.has(order.warehouse) && {
        warehouse: this.warehouses.get(order.warehouse)
      }),
      
      // Notes
      notes: order.notes || `Imported from ${order.source}`
    };

    try {
      const response = await this.client.post(`/documents/${docType}`, invoiceData);
      const invoiceId = response.data?.id;
      
      logger.debug(`Created ${docType} for order ${order.orderNumber || order.transactionCode}: ${invoiceId}`);
      
      // Optionally mark as paid if it's a completed order
      if (invoiceId && order.paid !== false) {
        await this.payDocument(docType, invoiceId, order);
      }
      
      return { success: true, invoiceId };
    } catch (error) {
      logger.error(`Failed to create ${docType} for ${order.orderNumber || order.id}: ${error.message}`);
      if (error.response?.data) {
        logger.error(`API response: ${JSON.stringify(error.response.data)}`);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark a document as paid
   * Reference: https://developers.holded.com/reference/pay-document-1
   */
  async payDocument(docType, documentId, order) {
    try {
      const paymentData = {
        date: Math.floor(new Date(order.date).getTime() / 1000),
        amount: order.total || order.amount,
        desc: `Pago ${order.paymentMethod || order.paymentType || 'auto'}`
      };
      
      // Add payment method ID if we can match it
      const paymentMethodKey = (order.paymentMethod || order.paymentType || '').toLowerCase();
      if (this.paymentMethods.has(paymentMethodKey)) {
        paymentData.paymentMethodId = this.paymentMethods.get(paymentMethodKey);
      }
      
      await this.client.post(`/documents/${docType}/${documentId}/pay`, paymentData);
      logger.debug(`Marked ${docType} ${documentId} as paid`);
    } catch (error) {
      // Non-fatal - invoice created but not marked as paid
      logger.warn(`Could not mark ${docType} ${documentId} as paid: ${error.message}`);
    }
  }

  async syncOrders(orders, docType = 'invoice') {
    await this.initialize();
    
    const results = { created: 0, errors: 0 };
    
    for (const order of orders) {
      const result = await this.createInvoice(order, docType);
      results[result.success ? 'created' : 'errors']++;
      
      // Rate limiting
      await this.sleep(200);
    }
    
    logger.info(`Order sync complete: ${results.created} ${docType}s created, ${results.errors} errors`);
    return results;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
