/**
 * create-410-accounts.js
 *
 * Creates 410... ledger accounts in Holded for each existing 400... individual account.
 * Skips the parent 40000000 account (group header).
 * Does NOT modify or delete any existing data.
 *
 * API: POST https://api.holded.com/api/accounting/v1/chartofaccounts
 *   prefix (int, 4 digits): 4100 → Holded auto-assigns next number (41000001, 41000002, ...)
 *   name (string): account name (preserved from the 400... account)
 *   color (string): hex color (preserved from the 400... account)
 *
 * Usage:
 *   node src/create-410-accounts.js            → dry-run (safe, just prints)
 *   node src/create-410-accounts.js --execute  → actually creates the accounts
 */

import 'dotenv/config';
import axios from 'axios';

const API_KEY = process.env.HOLDED_API_KEY;
const BASE_URL = 'https://api.holded.com/api/accounting/v1';
const EXECUTE = process.argv.includes('--execute');

if (!API_KEY) {
  console.error('ERROR: HOLDED_API_KEY not set in .env');
  process.exit(1);
}

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (will create accounts)' : 'DRY-RUN (no changes)'}`);
  console.log('Fetching chart of accounts from Holded...\n');

  let allAccounts;
  try {
    const response = await client.get('/chartofaccounts');
    allAccounts = response.data;
  } catch (error) {
    console.error('Failed to fetch accounts:', error.response?.data || error.message);
    process.exit(1);
  }

  // Filter 400... individual accounts, skip the parent 40000000
  const accounts400 = allAccounts
    .filter(a => String(a.num).startsWith('400') && a.num !== 40000000)
    .sort((a, b) => a.num - b.num);

  console.log(`Found ${accounts400.length} individual 400... accounts to replicate as 410...\n`);
  accounts400.forEach(a => console.log(`  ${a.num}  ${a.name}`));

  if (!EXECUTE) {
    console.log(`\nDry-run complete. ${accounts400.length} accounts would be created under prefix 4100.`);
    console.log('Run with --execute to create them.');
    return;
  }

  console.log('\nCreating 410... accounts...\n');

  let created = 0;
  let errors = 0;

  for (const account of accounts400) {
    const payload = {
      prefix: 4100,
      name: account.name,
      color: account.color
    };

    try {
      const response = await client.post('/account', payload);
      const accountId = response.data?.accountId || '?';
      console.log(`  CREATED: ${accountId}  ${account.name}  (was ${account.num})`);
      created++;
    } catch (error) {
      const msg = error.response?.data?.msg || error.response?.data?.message || JSON.stringify(error.response?.data) || error.message;
      console.error(`  ERROR: ${account.name} (${account.num}): ${msg}`);
      errors++;
    }

    await sleep(200);
  }

  console.log(`\nDone: ${created} created, ${errors} errors.`);
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
