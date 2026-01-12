const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true }, // Keeping int ID for app compatibility
    name: { type: String, required: true, unique: true, trim: true },
    unit: { type: String, required: true },
    basePrice: { type: Number, required: true },
    currentStock: { type: Number, default: 0 },
    minLevel: { type: Number, default: 100 },
    criticalLevel: { type: Number, default: 50 }
});

module.exports = mongoose.model('Product', productSchema);
