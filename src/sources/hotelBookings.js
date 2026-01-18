import axios from 'axios';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * MotoPress Hotel Booking Client
 * Uses WordPress REST API endpoint: /wp-json/mphb/v1/bookings
 */
export class HotelBookingClient {
  constructor(siteConfig) {
    this.name = siteConfig.name || 'Hotel Bookings';
    this.prefix = siteConfig.prefix || 'HOTEL';
    this.productSku = siteConfig.productSku || 'HOTEL-RESERVA'; // Single SKU for all hotel bookings
    this.defaultVatRate = siteConfig.defaultVatRate || 10; // Spanish hotel VAT is typically 10%
    this.pricesIncludeTax = siteConfig.pricesIncludeTax !== false; // Default true for hotels

    // Create axios client for WordPress REST API
    this.client = axios.create({
      baseURL: siteConfig.url,
      auth: {
        username: siteConfig.consumerKey,
        password: siteConfig.consumerSecret
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Fetch all bookings for a date range
   * @param {string} dateFrom - Start date (YYYY-MM-DD)
   * @param {string} dateTo - End date (YYYY-MM-DD)
   * @returns {Array} Normalized bookings
   */
  async getBookings(dateFrom, dateTo) {
    logger.info(`Fetching hotel bookings from ${this.name} (${dateFrom} to ${dateTo})...`);
    const bookings = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 1000; // Safety limit

    while (hasMore && page <= maxPages) {
      try {
        const response = await this.client.get('/wp-json/mphb/v1/bookings', {
          params: {
            per_page: 100,
            page,
            // Filter by check-in date range
            after: `${dateFrom}T00:00:00`,
            before: `${dateTo}T23:59:59`,
            status: ['confirmed', 'pending'] // Include confirmed and pending bookings
          }
        });

        // Break if no data returned
        if (!response.data || response.data.length === 0) {
          break;
        }

        bookings.push(...response.data);

        // Check pagination headers
        const totalPagesHeader = response.headers['x-wp-totalpages'];
        const totalPages = totalPagesHeader ? parseInt(totalPagesHeader) : 1;

        // Safety checks
        if (isNaN(totalPages) || totalPages <= 0 || totalPages > maxPages) {
          logger.warn(`Invalid totalPages (${totalPagesHeader}) from ${this.name}, stopping pagination`);
          break;
        }

        hasMore = page < totalPages;
        page++;
      } catch (error) {
        logger.error(`Error fetching bookings from ${this.name}: ${error.message}`);
        throw error;
      }
    }

    if (page > maxPages) {
      logger.warn(`Hit maximum pages limit (${maxPages}) for ${this.name}`);
    }

    logger.info(`Fetched ${bookings.length} hotel bookings from ${this.name}`);

    // Normalize bookings in batches
    const normalizedBookings = [];
    const batchSize = 50;

    for (let i = 0; i < bookings.length; i += batchSize) {
      const batch = bookings.slice(i, i + batchSize);
      try {
        const normalizedBatch = batch.map(b => this.normalizeBooking(b));
        normalizedBookings.push(...normalizedBatch);
      } catch (error) {
        logger.error(`Error normalizing booking batch ${Math.floor(i/batchSize) + 1} from ${this.name}: ${error.message}`);
        // Continue with remaining batches
      }
    }

    return normalizedBookings;
  }

  /**
   * Normalize MotoPress booking to standard order format
   * @param {Object} mphbBooking - Raw booking from MotoPress API
   * @returns {Object} Normalized booking in order format
   */
  normalizeBooking(mphbBooking) {
    // Extract customer information
    const customer = this.extractCustomer(mphbBooking);

    // Extract booking items (rooms/services)
    const items = this.extractItems(mphbBooking);

    // Calculate totals
    const subtotal = parseFloat(mphbBooking.total_price || 0) - parseFloat(mphbBooking.total_tax || 0);
    const tax = parseFloat(mphbBooking.total_tax || 0);
    const total = parseFloat(mphbBooking.total_price || 0);

    return {
      source: 'hotel',
      sitePrefix: this.prefix,
      siteName: this.name,
      id: mphbBooking.id,
      orderNumber: mphbBooking.id.toString(), // Use booking ID as order number
      status: mphbBooking.status,
      date: mphbBooking.date_created || mphbBooking.check_in_date,
      total,
      subtotal,
      tax,
      currency: mphbBooking.currency || 'EUR',
      paymentMethod: 'WooCommerce', // Tag as WooCommerce (source site)
      customer,
      items,
      // Hotel bookings are typically unpaid until check-in/check-out
      paid: mphbBooking.status === 'confirmed' ? false : false,
      // Additional hotel-specific metadata
      metadata: {
        checkIn: mphbBooking.check_in_date,
        checkOut: mphbBooking.check_out_date,
        nights: this.calculateNights(mphbBooking.check_in_date, mphbBooking.check_out_date),
        guests: mphbBooking.guests || 1
      }
    };
  }

  /**
   * Extract customer information from booking
   */
  extractCustomer(booking) {
    return {
      name: this.getCustomerName(booking),
      email: booking.customer?.email || booking.email || '',
      phone: booking.customer?.phone || booking.phone || '',
      company: booking.customer?.company || '',
      dni: (booking.customer?.dni || booking.dni || '').toUpperCase(),
      vatNumber: booking.customer?.vat_number || booking.vat_number || '',
      address: this.getAddress(booking),
      city: booking.customer?.city || booking.city || '',
      postalCode: booking.customer?.zip || booking.postcode || '',
      province: booking.customer?.state || booking.state || '',
      country: booking.customer?.country || booking.country || 'ES',
      countryName: this.getCountryName(booking.customer?.country || booking.country)
    };
  }

  /**
   * Get customer name from various possible fields
   */
  getCustomerName(booking) {
    if (booking.customer?.first_name || booking.customer?.last_name) {
      return `${booking.customer.first_name || ''} ${booking.customer.last_name || ''}`.trim();
    }
    if (booking.first_name || booking.last_name) {
      return `${booking.first_name || ''} ${booking.last_name || ''}`.trim();
    }
    if (booking.customer?.name) {
      return booking.customer.name;
    }
    return 'Cliente Hotel';
  }

  /**
   * Get address from booking
   */
  getAddress(booking) {
    const address1 = booking.customer?.address_1 || booking.address_1 || '';
    const address2 = booking.customer?.address_2 || booking.address_2 || '';
    return [address1, address2].filter(Boolean).join(', ');
  }

  /**
   * Extract line items from booking (rooms + services)
   * Uses single product SKU for all items to ensure correct cuenta contable
   */
  extractItems(booking) {
    const items = [];

    // Add room reservations as line items
    if (booking.reserved_rooms && Array.isArray(booking.reserved_rooms)) {
      booking.reserved_rooms.forEach((room, index) => {
        const roomPrice = parseFloat(room.total_price || room.price || 0);
        const roomTax = parseFloat(room.total_tax || 0);
        const roomTotal = roomPrice - roomTax;
        const quantity = this.calculateNights(booking.check_in_date, booking.check_out_date);

        items.push({
          sku: this.productSku, // Use single product SKU for all bookings
          name: room.room_type_title || room.title || `Habitación ${index + 1}`,
          description: room.room_type_description || '',
          quantity: quantity > 0 ? quantity : 1,
          price: quantity > 0 ? roomTotal / quantity : roomTotal,
          total: roomTotal,
          totalWithTax: roomPrice,
          tax: roomTax,
          taxRate: this.calculateTaxRate(roomTotal, roomTax),
          discount: 0
        });
      });
    }

    // Add services as line items
    if (booking.reserved_services && Array.isArray(booking.reserved_services)) {
      booking.reserved_services.forEach((service, index) => {
        const servicePrice = parseFloat(service.total_price || service.price || 0);
        const serviceTax = parseFloat(service.total_tax || 0);
        const serviceTotal = servicePrice - serviceTax;
        const quantity = parseInt(service.quantity || 1);

        items.push({
          sku: this.productSku, // Use single product SKU for all bookings
          name: service.title || `Servicio ${index + 1}`,
          description: service.description || '',
          quantity,
          price: quantity > 0 ? serviceTotal / quantity : serviceTotal,
          total: serviceTotal,
          totalWithTax: servicePrice,
          tax: serviceTax,
          taxRate: this.calculateTaxRate(serviceTotal, serviceTax),
          discount: 0
        });
      });
    }

    // Fallback: create a single item from total if no items found
    if (items.length === 0) {
      const total = parseFloat(booking.total_price || 0);
      const tax = parseFloat(booking.total_tax || 0);
      const subtotal = total - tax;
      const nights = this.calculateNights(booking.check_in_date, booking.check_out_date);

      items.push({
        sku: this.productSku, // Use single product SKU for all bookings
        name: `Reserva Hotel #${booking.id}`,
        description: `Check-in: ${booking.check_in_date}, Check-out: ${booking.check_out_date}`,
        quantity: nights > 0 ? nights : 1,
        price: nights > 0 ? subtotal / nights : subtotal,
        total: subtotal,
        totalWithTax: total,
        tax,
        taxRate: this.calculateTaxRate(subtotal, tax),
        discount: 0
      });
    }

    return items;
  }

  /**
   * Calculate number of nights between dates
   */
  calculateNights(checkIn, checkOut) {
    if (!checkIn || !checkOut) return 1;
    try {
      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);
      const diffTime = Math.abs(checkOutDate - checkInDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? diffDays : 1;
    } catch (error) {
      logger.warn(`Error calculating nights: ${error.message}`);
      return 1;
    }
  }

  /**
   * Calculate effective tax rate
   */
  calculateTaxRate(subtotal, tax) {
    if (subtotal > 0 && tax > 0) {
      return Math.round((tax / subtotal) * 100);
    }
    return this.defaultVatRate;
  }

  /**
   * Get country name from code
   */
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
}

/**
 * Fetch bookings from hotel booking system
 * @param {Object} hotelConfig - Hotel configuration
 * @param {string} dateFrom - Start date (YYYY-MM-DD)
 * @param {string} dateTo - End date (YYYY-MM-DD)
 * @returns {Array} Normalized bookings
 */
export async function fetchHotelBookings(hotelConfig, dateFrom, dateTo) {
  // Return empty array if hotel not configured
  if (!hotelConfig || !hotelConfig.url || !hotelConfig.consumerKey) {
    logger.info('Hotel bookings not configured, skipping...');
    return [];
  }

  try {
    const client = new HotelBookingClient(hotelConfig);
    const bookings = await client.getBookings(dateFrom, dateTo);
    return bookings;
  } catch (error) {
    logger.error(`Failed to fetch hotel bookings: ${error.message}`);
    return []; // Return empty array to allow other syncs to continue
  }
}
