const mongoose = require('mongoose');

const posterSchema = new mongoose.Schema({
  posterName: {
    type: String,
    required: true,
    trim: true
  },
  imageUrl: {
    type: String,
    required: true
  },
  // Defines where the user goes when clicking the poster
  navigationTo: {
    type: String,
    enum: ['none', 'product', 'category'],
    default: 'none'
  },
  // Stores the ID of the Product, Category, SubCategory, or Brand
  targetId: {
    type: String,
    default: null
  }
}, {
  timestamps: true 
});

const Poster = mongoose.model('Poster', posterSchema);

module.exports = Poster;