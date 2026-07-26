const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  salesTargets: {
    daily: { type: Number, default: 1000 },
    weekly: { type: Number, default: 7000 },
    monthly: { type: Number, default: 30000 },
    yearly: { type: Number, default: 365000 }
  },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', settingsSchema);