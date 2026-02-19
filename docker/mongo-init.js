// MongoDB initialization - creates databases and indexes
// Runs automatically on first container start

db = db.getSiblingDB('users');
db.createCollection('users');
db.users.createIndex({ email: 1 }, { unique: true });

db = db.getSiblingDB('products');
db.createCollection('products');
db.products.createIndex({ name: 'text', description: 'text' });
db.products.createIndex({ category: 1 });
db.products.createIndex({ price: 1 });
db.products.createIndex({ isActive: 1 });

// Seed sample products
db.products.insertMany([
  {
    name: "Wireless Headphones",
    description: "Premium noise-cancelling wireless headphones with 30hr battery",
    price: 149.99,
    category: "Electronics",
    tags: ["audio", "wireless", "noise-cancelling"],
    images: ["https://via.placeholder.com/400x400?text=Headphones"],
    inventory: { quantity: 50, reserved: 0 },
    sku: "ELEC-HP-001",
    isActive: true,
    rating: 4.5,
    reviewCount: 128,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Mechanical Keyboard",
    description: "TKL mechanical keyboard with Cherry MX switches and RGB backlight",
    price: 89.99,
    category: "Electronics",
    tags: ["keyboard", "mechanical", "RGB", "gaming"],
    images: ["https://via.placeholder.com/400x400?text=Keyboard"],
    inventory: { quantity: 30, reserved: 0 },
    sku: "ELEC-KB-001",
    isActive: true,
    rating: 4.7,
    reviewCount: 89,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Running Shoes",
    description: "Lightweight running shoes with responsive cushioning",
    price: 119.95,
    category: "Footwear",
    tags: ["running", "sports", "shoes"],
    images: ["https://via.placeholder.com/400x400?text=Shoes"],
    inventory: { quantity: 75, reserved: 0 },
    sku: "FOOT-RS-001",
    isActive: true,
    rating: 4.3,
    reviewCount: 245,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Coffee Maker",
    description: "12-cup programmable coffee maker with built-in grinder",
    price: 79.99,
    category: "Kitchen",
    tags: ["coffee", "kitchen", "appliance"],
    images: ["https://via.placeholder.com/400x400?text=Coffee+Maker"],
    inventory: { quantity: 20, reserved: 0 },
    sku: "KITC-CM-001",
    isActive: true,
    rating: 4.6,
    reviewCount: 312,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

db = db.getSiblingDB('orders');
db.createCollection('orders');
db.orders.createIndex({ userId: 1 });
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ createdAt: -1 });

db = db.getSiblingDB('payments');
db.createCollection('payments');
db.payments.createIndex({ orderId: 1 });
db.payments.createIndex({ userId: 1 });

print('MongoDB initialization complete');
