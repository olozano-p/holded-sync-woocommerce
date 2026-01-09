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

export function validateConfig() {
  const errors = [];
  
  if (!config.holded.apiKey) {
    errors.push('HOLDED_API_KEY is required');
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
