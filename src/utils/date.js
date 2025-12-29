import { config } from '../config.js';

export function getYesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatDate(date);
}

export function getDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDate(date);
}

export function formatDate(date) {
  return date.toISOString().split('T')[0];
}

export function formatDateHolded(date) {
  // Holded expects dd/mm/yyyy
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function getDateRange(daysBack = config.sync.daysBack) {
  return {
    from: getDaysAgo(daysBack),
    to: getYesterday()
  };
}

export function parseISODate(isoString) {
  return new Date(isoString);
}
