/**
 * Square Category to Holded Sales Channel Mapping
 *
 * Maps Square catalog categories to Holded sales channel names.
 * The category names should match exactly what's in your Square catalog.
 * Sales channel names must match exactly what's in Holded (case-sensitive).
 *
 * The sales channel in Holded determines the cuenta contable.
 */

export const squareCategorySalesChannels = {
  '00. Begudes Bar Amrita': 'Restaurant i Bar',
  '01. Tapes Bar Amrita': 'Restaurant i Bar',
  '02. Restaurant Amrita': 'Restaurant i Bar',
  '02. Entrepans Amrita': 'Restaurant i Bar',
  '03. Vins Amrita': 'Restaurant i Bar',
  '04. Llibres': 'Cantir',
  '05. Artesanies': 'Cantir',
  '07. Hotel Can Bordoi': 'Hotel',
};

/**
 * Default sales channel for Square items that don't match any category
 * Set to null to skip sales channel assignment for unmatched categories
 */
export const squareDefaultSalesChannel = 'Restaurant i Bar';

/**
 * Get sales channel name for a Square category
 * @param {string} categoryName - The category name from Square
 * @returns {string|null} The Holded sales channel name, or null if not mapped
 */
export function getSalesChannelForCategory(categoryName) {
  if (!categoryName) return squareDefaultSalesChannel;

  // Try exact match first
  if (squareCategorySalesChannels[categoryName]) {
    return squareCategorySalesChannels[categoryName];
  }

  // Try case-insensitive match
  const lowerCategory = categoryName.toLowerCase();
  for (const [key, value] of Object.entries(squareCategorySalesChannels)) {
    if (key.toLowerCase() === lowerCategory) {
      return value;
    }
  }

  return squareDefaultSalesChannel;
}
