const mongoose = require('mongoose');

const stockLedgerSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    date: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    productId: { type: Number, required: true },
    productName: { type: String, required: true },
    type: { type: String, enum: ['IN', 'OUT', 'CREATE', 'PRICE_UPDATE'], required: true },
    quantity: { type: Number, default: 0 },
    performedBy: { type: String, required: true }, // e.g., "Manager (ID: xxx)"
    reference: { type: String } // e.g., "Bulk Purchase", "Order #1001", "Initial Creation"
});

module.exports = mongoose.model('StockLedger', stockLedgerSchema);
