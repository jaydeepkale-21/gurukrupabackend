-- Database Schema for Franchise Inventory System

-- 1. Users Table (Roles: 'super_owner', 'warehouse_manager', 'franchise_owner')
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('super_owner', 'warehouse_manager', 'franchise_owner')),
    franchise_id INTEGER, -- Nullable, linked if role is franchise_owner
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Franchises Table
CREATE TABLE franchises (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    agreement_expiry_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Products (Raw Materials)
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(20) NOT NULL, -- e.g., 'kg', 'ltr', 'pcs'
    base_price DECIMAL(10, 2) NOT NULL, -- Standard price
    is_active BOOLEAN DEFAULT TRUE
);

-- 4. Franchise Specific Prices (If different from base price)
CREATE TABLE franchise_prices (
    franchise_id INTEGER REFERENCES franchises(id),
    product_id INTEGER REFERENCES products(id),
    price DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (franchise_id, product_id)
);

-- 5. Inventory Ledger (Central Warehouse Stock)
-- Ledger based: All movements are INSERTs, stock is calculated by SUM(quantity) where IN is +ve and OUT is -ve
CREATE TABLE inventory_ledger (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    transaction_type VARCHAR(10) CHECK (transaction_type IN ('IN', 'OUT')),
    quantity DECIMAL(10, 2) NOT NULL, -- Positive value
    reference_id INTEGER, -- Can be order_id or purchase_id
    performed_by_user_id INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Orders
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    franchise_id INTEGER REFERENCES franchises(id),
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Dispatched', 'Delivered', 'Cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Order Items
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(10, 2) NOT NULL,
    price_at_time_of_order DECIMAL(10, 2) NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_orders_franchise ON orders(franchise_id);
CREATE INDEX idx_ledger_product ON inventory_ledger(product_id);
