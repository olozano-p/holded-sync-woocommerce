import 'dotenv/config';

export const config = {
  holded: {
    apiKey: process.env.HOLDED_API_KEY,
    baseUrl: 'https://api.holded.com/api/invoicing/v1',
    docType: process.env.HOLDED_DOC_TYPE || 'invoice',
    numberingFormat: process.env.HOLDED_NUMBERING_FORMAT || 'F[YY]%%%%',
    salesChannel: process.env.HOLDED_SALES_CHANNEL || '',
    warehouse: process.env.HOLDED_WAREHOUSE || ''
  },

  holdedSecondary: {
    apiKey: process.env.HOLDED_SECONDARY_API_KEY,
    baseUrl: 'https://api.holded.com/api/invoicing/v1',
    docType: process.env.HOLDED_DOC_TYPE || 'invoice',
    numberingFormat: process.env.HOLDED_NUMBERING_FORMAT || 'F[YY]%%%%',
    salesChannel: process.env.HOLDED_SALES_CHANNEL || '',
    warehouse: process.env.HOLDED_WAREHOUSE || '',
    skus: process.env.HOLDED_SECONDARY_SKUS ?
      process.env.HOLDED_SECONDARY_SKUS.split(',').map(sku => sku.trim()) : [],
    vatRate: parseFloat(process.env.HOLDED_SECONDARY_VAT_RATE || '21')
  },
  
  sumup: {
    apiKey: process.env.SUMUP_API_KEY,
    baseUrl: 'https://api.sumup.com/v0.1',
    defaultVatRate: parseFloat(process.env.SUMUP_DEFAULT_VAT_RATE || process.env.DEFAULT_VAT_RATE || '21')
  },
  
  woocommerce: [
    {
      name: process.env.WC_SITE1_PREFIX || 'S1',
      url: process.env.WC_SITE1_URL,
      consumerKey: process.env.WC_SITE1_KEY,
      consumerSecret: process.env.WC_SITE1_SECRET,
      prefix: process.env.WC_SITE1_PREFIX || 'S1',
      defaultVatRate: parseFloat(process.env.WC_SITE1_DEFAULT_VAT_RATE || process.env.DEFAULT_VAT_RATE || '21')
    },
    {
      name: process.env.WC_SITE2_PREFIX || 'S2',
      url: process.env.WC_SITE2_URL,
      consumerKey: process.env.WC_SITE2_KEY,
      consumerSecret: process.env.WC_SITE2_SECRET,
      prefix: process.env.WC_SITE2_PREFIX || 'S2',
      defaultVatRate: parseFloat(process.env.WC_SITE2_DEFAULT_VAT_RATE || process.env.DEFAULT_VAT_RATE || '21')
    },
    {
      name: process.env.WC_SITE3_PREFIX || 'S3',
      url: process.env.WC_SITE3_URL,
      consumerKey: process.env.WC_SITE3_KEY,
      consumerSecret: process.env.WC_SITE3_SECRET,
      prefix: process.env.WC_SITE3_PREFIX || 'S3',
      defaultVatRate: parseFloat(process.env.WC_SITE3_DEFAULT_VAT_RATE || process.env.DEFAULT_VAT_RATE || '21')
    }
  ].filter(site => site.url && site.consumerKey),
  
  sync: {
    daysBack: parseInt(process.env.SYNC_DAYS_BACK || '1', 10),
    defaultVatRate: parseFloat(process.env.DEFAULT_VAT_RATE || '21'),
    timezone: process.env.TZ || 'Europe/Madrid'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

// Utility functions for SKU-based routing
export function isSecondaryProduct(product) {
  return config.holdedSecondary.skus.includes(product.sku);
}

export function hasSecondarySkus(order) {
  return order.items && order.items.some(item =>
    config.holdedSecondary.skus.includes(item.sku)
  );
}

export function filterProductsByDestination(products) {
  const secondary = [];
  const primary = [];

  products.forEach(product => {
    if (isSecondaryProduct(product)) {
      secondary.push(product);
    } else {
      primary.push(product);
    }
  });

  return { primary, secondary };
}

export function filterOrdersByDestination(orders) {
  const secondary = [];
  const primary = [];

  orders.forEach(order => {
    if (hasSecondarySkus(order)) {
      secondary.push(order);
    } else {
      primary.push(order);
    }
  });

  return { primary, secondary };
}

export function validateConfig() {
  const errors = [];

  if (!config.holded.apiKey) {
    errors.push('HOLDED_API_KEY is required');
  }

  // Validate secondary Holded configuration if SKUs are configured
  if (config.holdedSecondary.skus.length > 0 && !config.holdedSecondary.apiKey) {
    errors.push('HOLDED_SECONDARY_API_KEY is required when HOLDED_SECONDARY_SKUS is configured');
  }

  if (config.woocommerce.length === 0 && !config.sumup.apiKey) {
    errors.push('At least one WooCommerce site or SumUp API key is required');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}
