import axios from 'axios';
import 'dotenv/config';

const api = axios.create({
  baseURL: 'https://api.holded.com/api/invoicing/v1',
  headers: { key: process.env.HOLDED_API_KEY }
});

async function updateBokProducts() {
  // Get all products
  const { data: products } = await api.get('/products');
  
  // Filter BOK-* SKUs
  const bokProducts = products.filter(p => p.sku?.startsWith('BOK-'));
  console.log(`Found ${bokProducts.length} BOK products`);
  
  for (const product of bokProducts) {
    console.log(`Updating ${product.sku}: ${product.name}`);
    await api.put(`/products/${product.id}`, { tax: 4 });
    await new Promise(r => setTimeout(r, 300)); // Rate limit
  }
  
  console.log('Done!');
}

updateBokProducts().catch(console.error);
