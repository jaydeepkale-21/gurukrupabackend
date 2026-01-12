const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Hashed
  role: {
    type: String,
    enum: ['warehouse_manager', 'franchise_owner'],
    required: true
  },
  franchiseId: { type: Number, default: null }, // For franchise owners
  outletName: { type: String, default: null },

  // Agreement Details (for Franchise Owner)
  agreementStartDate: { type: Date, default: null },
  agreementEndDate: { type: Date, default: null } // If expired, block orders
});

module.exports = mongoose.model('User', userSchema);
