import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { formatDateHolded } from '../utils/date.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportsDir = path.join(__dirname, '../../exports');

export async function exportProductsToExcel(products, filename = null) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Productos');

  // Headers matching Holded import format (Importar_Productos.xlsx)
  const headers = [
    'SKU',
    'Nombre',
    'Descripción',
    'Código de barras',
    'Código de fábrica',
    'cat - Categoría',
    'Coste (Subtotal)',
    'Precio compra (Subtotal)',
    'Precio venta (Subtotal)',
    'Impuesto de venta',
    'Impuesto de compras',
    'Stock',
    'Peso',
    'Fecha de inicio dd/mm/yyyy',
    'Tags separados por -',
    'Proveedor (Código)',
    'Cuenta ventas',
    'Cuenta compras',
    'Almacén'
  ];

  sheet.addRow(headers);
  styleHeaderRow(sheet, 1);

  for (const product of products) {
    sheet.addRow([
      `${product.sitePrefix}-${product.sku}`,           // SKU (prefixed)
      product.name,                                      // Nombre
      product.description?.substring(0, 500) || '',      // Descripción
      '',                                                // Código de barras
      '',                                                // Código de fábrica
      product.categories?.[0] || '',                     // Categoría
      '',                                                // Coste
      '',                                                // Precio compra
      product.price,                                     // Precio venta
      config.sync.defaultVatRate,                        // IVA venta
      0,                                                 // IVA compra
      product.stock || 0,                                // Stock
      product.weight || 0,                               // Peso
      formatDateHolded(new Date()),                      // Fecha inicio
      product.tags?.join('-') || '',                     // Tags
      '',                                                // Proveedor
      '700000000',                                       // Cuenta ventas
      '62900000',                                        // Cuenta compras
      ''                                                 // Almacén
    ]);
  }

  autoFitColumns(sheet);

  const outputPath = path.join(
    exportsDir, 
    filename || `productos_${new Date().toISOString().split('T')[0]}.xlsx`
  );
  
  await workbook.xlsx.writeFile(outputPath);
  logger.info(`Products exported to: ${outputPath}`);
  
  return outputPath;
}

/**
 * Export orders/invoices to Holded-compatible Excel format
 * Based on Importar_Facturas_emitidas.xlsx structure
 * 
 * IMPORTANT: Each row represents ONE LINE ITEM
 * Multiple rows with same invoice number = multiple items in one invoice
 */
export async function exportOrdersToExcel(orders, filename = null) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Facturas');

  // Headers EXACTLY matching Holded import format (32 columns)
  const headers = [
    'Num factura',                    // Invoice number
    'Formato de numeración',          // Numbering format (e.g., F[YY]%%%%)
    'Fecha dd/mm/yyyy',               // Invoice date
    'Fecha de vencimiento dd/mm/yyyy',// Due date
    'Descripción',                    // Invoice description
    'Nombre del contacto',            // Contact name
    'NIF del contacto',               // Contact VAT number
    'Dirección',                      // Address
    'Población',                      // City
    'Código postal',                  // Postal code
    'Provincia',                      // Province
    'País',                           // Country
    'Concepto',                       // Item concept/name
    'Descripción del producto',       // Item description
    'SKU',                            // Item SKU
    'Precio unidad',                  // Unit price (subtotal, no tax)
    'Unidades',                       // Quantity
    'Descuento %',                    // Discount %
    'IVA %',                          // VAT %
    'Retención %',                    // Withholding %
    'Rec. de eq. %',                  // Equivalence surcharge %
    'Operación',                      // Operation type (general, intra, export)
    'Forma de pago (ID)',             // Payment method ID
    'Cantidad cobrada',               // Amount paid
    'Fecha de cobro',                 // Payment date
    'Cuenta de pago',                 // Payment account
    'Tags separados por -',           // Tags
    'Nombre canal de venta',          // Sales channel name
    'Cuenta canal de venta',          // Sales channel account
    'Moneda',                         // Currency
    'Cambio de moneda',               // Exchange rate
    'Almacén'                         // Warehouse ID
  ];

  sheet.addRow(headers);
  styleHeaderRow(sheet, 1);

  // Generate invoice numbers (simple sequential for imports)
  let invoiceCounter = 1;
  
  for (const order of orders) {
    // Generate invoice number with format
    const year = new Date(order.date).getFullYear().toString().slice(-2);
    const invoiceNum = `F${year}${String(invoiceCounter).padStart(4, '0')}`;
    const invoiceDate = formatDateHolded(order.date);
    
    // Each item becomes a row (Holded imports this way)
    const items = order.items || [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isFirstRow = i === 0;
      
      sheet.addRow([
        invoiceNum,                                       // Num factura
        'F[YY]%%%%',                                      // Formato numeración
        invoiceDate,                                      // Fecha
        invoiceDate,                                      // Fecha vencimiento
        isFirstRow ? (order.description || `${order.source} - ${order.siteName || 'Venta'} #${order.orderNumber || order.transactionCode || order.id}`) : '',  // Descripción (only first row)
        isFirstRow ? (order.customer?.name || 'Cliente') : '',  // Nombre contacto
        isFirstRow ? (order.customer?.vatNumber || '') : '',    // NIF
        isFirstRow ? (order.customer?.address || '') : '',      // Dirección
        isFirstRow ? (order.customer?.city || '') : '',         // Población
        isFirstRow ? (order.customer?.postalCode || '') : '',   // CP
        isFirstRow ? (order.customer?.province || '') : '',     // Provincia
        isFirstRow ? (order.customer?.country || 'España') : '',// País
        item.name || 'Producto',                          // Concepto
        item.description || '',                           // Descripción producto
        item.sku || '',                                   // SKU
        item.price || 0,                                  // Precio unidad (subtotal)
        item.quantity || 1,                               // Unidades
        item.discount || 0,                               // Descuento %
        item.taxRate || config.sync.defaultVatRate,       // IVA %
        0,                                                // Retención %
        0,                                                // Rec. equivalencia %
        'general',                                        // Operación
        '',                                               // Forma de pago ID
        isFirstRow ? (order.total || order.amount || 0) : '', // Cantidad cobrada
        isFirstRow ? invoiceDate : '',                    // Fecha de cobro
        '',                                               // Cuenta de pago
        [order.source, order.sitePrefix].filter(Boolean).join('-'),  // Tags
        order.salesChannel || '',                         // Canal de venta
        '700000000',                                      // Cuenta canal
        (order.currency || 'EUR').toLowerCase(),          // Moneda
        1,                                                // Cambio
        ''                                                // Almacén
      ]);
    }
    
    invoiceCounter++;
  }

  autoFitColumns(sheet);

  const outputPath = path.join(
    exportsDir, 
    filename || `facturas_${new Date().toISOString().split('T')[0]}.xlsx`
  );
  
  await workbook.xlsx.writeFile(outputPath);
  logger.info(`Invoices exported to: ${outputPath}`);
  
  return outputPath;
}

/**
 * Export a simple sales summary (non-Holded format, for reporting)
 */
export async function exportSalesSummary(orders, filename = null) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Resumen Ventas');

  const headers = [
    'Fecha',
    'Origen',
    'Nº Pedido',
    'Cliente',
    'Email',
    'Subtotal',
    'IVA',
    'Total',
    'Método Pago',
    'Productos'
  ];

  sheet.addRow(headers);
  styleHeaderRow(sheet, 1);

  for (const order of orders) {
    const productList = order.items?.map(i => `${i.name} x${i.quantity}`).join('; ') || '';
    
    sheet.addRow([
      formatDateHolded(order.date),
      `${order.source}${order.sitePrefix ? ` - ${order.sitePrefix}` : ''}`,
      order.orderNumber || order.transactionCode || order.id,
      order.customer?.name || 'Cliente',
      order.customer?.email || '',
      order.subtotal || (order.total - (order.tax || 0)),
      order.tax || 0,
      order.total || order.amount,
      order.paymentMethod || order.paymentType || '',
      productList
    ]);
  }

  autoFitColumns(sheet);

  const outputPath = path.join(
    exportsDir, 
    filename || `resumen_ventas_${new Date().toISOString().split('T')[0]}.xlsx`
  );
  
  await workbook.xlsx.writeFile(outputPath);
  logger.info(`Sales summary exported to: ${outputPath}`);
  
  return outputPath;
}

// Helper functions
function styleHeaderRow(sheet, rowNum) {
  const headerRow = sheet.getRow(rowNum);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
}

function autoFitColumns(sheet) {
  sheet.columns.forEach(column => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, cell => {
      const length = cell.value ? cell.value.toString().length : 0;
      maxLength = Math.max(maxLength, Math.min(length, 50));
    });
    column.width = maxLength + 2;
  });
}
