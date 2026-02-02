/**
 * Square Category to Holded Account Mapping
 *
 * Maps Square catalog categories to Holded account codes (cuentas contables).
 * The category names should match exactly what's in your Square catalog.
 * Account codes are the Holded "cuenta contable" numbers.
 *
 * Example: Items in "00. Begudes Bar Amrita" category will use account 70000002
 */

export const squareCategoryAccounts = {
  '00. Begudes Bar Amrita': '70000002',
  '02. Restaurant Amrita': '70000002',
  '04. Llibres': '70000001',
  '01. Tapes Bar Amrita': '70000002',
  '07. Hotel Can Bordoi': '70500007',
  '03. Vins Amrita': '70000002',
  '02. Entrepans Amrita': '70000002',
  '05. Artesanies': '70000001',
};

/**
 * Default account for Square items that don't match any category
 * Set to null to skip account assignment for unmatched categories
 */
export const squareDefaultAccount = '70000002';

/**
 * Get account code for a Square category
 * @param {string} categoryName - The category name from Square
 * @returns {string|null} The Holded account code, or null if not mapped
 */
export function getAccountForCategory(categoryName) {
  if (!categoryName) return squareDefaultAccount;

  // Try exact match first
  if (squareCategoryAccounts[categoryName]) {
    return squareCategoryAccounts[categoryName];
  }

  // Try case-insensitive match
  const lowerCategory = categoryName.toLowerCase();
  for (const [key, value] of Object.entries(squareCategoryAccounts)) {
    if (key.toLowerCase() === lowerCategory) {
      return value;
    }
  }

  return squareDefaultAccount;
}
