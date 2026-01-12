const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD HH:MM
    totalAmount: { type: Number, required: true },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Dispatched', 'Delivered', 'Cancelled'],
        default: 'Pending'
    },
    itemsCount: { type: Number, required: true },
    itemsSummary: { type: String, required: true }, // e.g., "Tea, Sugar..."
    items: { type: Map, of: Number }, // productId -> quantity
    franchiseId: { type: Number, required: true }, // Link to user
});

module.exports = mongoose.model('Order', orderSchema);
