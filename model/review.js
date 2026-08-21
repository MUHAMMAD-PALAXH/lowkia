// In your Review Model/Schema file (e.g., Review.js)
const mongoose = require('mongoose');
const tenantPlugin = require("./plugins/tenant.plugin");
const Schema = mongoose.Schema;

const replySchema = new Schema({
    // Make sure 'userId' correctly references your User model
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, 
    comment: { type: String, required: true },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now },
});

const reviewSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // Main reviewer
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    // The replies array must contain the sub-schema or objects with the correct ref
    replies: [replySchema], // <-- Ensure this is correctly defined and referenced
}, { timestamps: true });

reviewSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Review', reviewSchema);