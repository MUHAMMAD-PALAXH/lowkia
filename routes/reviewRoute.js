// ================== IMPORTS ==================
const express = require('express');
const router = express.Router();
const Review = require('../model/review');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

// ================== ROUTES ==================

// Get all reviews for a product
router.get('/:productId', asyncHandler(async (req, res) => {
    const { productId } = req.params;
    try {
        // We only populate 'name' for minimal data transfer
        const reviews = await Review.find({ productId })
            .populate('userId', 'name') // Populates the main reviewer
            .populate('replies.userId', 'name'); // Populates the user on each reply
        res.json({ success: true, data: reviews });
    } catch (error) {
        console.error('GET /api/reviews/:productId error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
}));

// Add a review (only one review per user per product)
router.post('/:productId', asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { userId, rating, comment } = req.body;

    console.log('POST /api/reviews/:productId body:', req.body);

    if (!userId || !rating || !comment) {
        return res.status(400).json({
            success: false,
            message: "userId, rating and comment are required.",
        });
    }

    const existingReview = await Review.findOne({ productId, userId });
    if (existingReview) {
        return res.status(400).json({ success: false, message: "You already reviewed this product." });
    }

    const newReview = new Review({ productId, userId, rating, comment });
    await newReview.save();

    res.json({ success: true, message: "Review added successfully.", data: newReview });
}));

// PATCH: Edit a main review ⭐️ NEW ENDPOINT
router.patch('/:reviewId', asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const { userId, rating, comment } = req.body;

    if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required." });
    }
    if (!rating && !comment) {
        return res.status(400).json({ success: false, message: "Either rating or comment is required for update." });
    }

    const updateFields = {};
    if (rating !== undefined) updateFields.rating = rating;
    if (comment !== undefined) updateFields.comment = comment;

    // Find the review by ID and ensure the requesting user is the owner
    const updatedReview = await Review.findOneAndUpdate(
        { _id: reviewId, userId: userId },
        { $set: updateFields },
        { new: true }
    );

    if (!updatedReview) {
        return res.status(404).json({ success: false, message: "Review not found or user not authorized to edit." });
    }

    res.json({ success: true, message: "Review updated successfully.", data: updatedReview });
}));

// Like/unlike a review
router.patch('/like/:reviewId', asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const { userId } = req.body;

    console.log('PATCH /api/reviews/like/:reviewId body:', req.body);

    if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required to like/unlike." });
    }

    // Attempt to pull (unlike) first.
    let review = await Review.findOneAndUpdate(
        { _id: reviewId, likes: userId },
        { $pull: { likes: userId } },
        { new: true }
    );

    if (!review) {
        // If pull failed, user must not have liked it yet, so we push (like).
        review = await Review.findOneAndUpdate(
            { _id: reviewId },
            { $addToSet: { likes: userId } }, // $addToSet prevents duplicates
            { new: true }
        );
    }
    
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    res.json({ success: true, message: "Review like status updated.", data: review });
}));

// Delete a review (only owner can delete)
router.delete('/:reviewId', asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    // Get userId from QUERY parameters (as set up by the client)
    const userId = req.query.userId || req.body.userId; 

    console.log('DELETE /api/reviews/:reviewId received userId:', userId);

    if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required to delete review." });
    }

    const review = await Review.findById(reviewId);
    if (!review) return res.status(404).json({ success: false, message: "Review not found." });

    // Only owner can delete (Ensure userId is a string for comparison)
    if (review.userId.toString() !== userId.toString()) {
        return res.status(403).json({ success: false, message: "You can only delete your own review." });
    }

    // Use findByIdAndDelete for a cleaner operation
    await Review.findByIdAndDelete(reviewId); 
    
    res.json({ success: true, message: "Review deleted successfully." });
}));


// ================== REPLY ROUTES ==================

// Add a reply to a review
router.post('/reply/:reviewId', asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const { userId, comment } = req.body;

    if (!userId || !comment) {
        return res.status(400).json({ success: false, message: "userId and comment are required." });
    }

    // Find and update the review document by pushing a new reply object
    const updatedReview = await Review.findByIdAndUpdate(
        reviewId,
        { $push: { replies: { userId, comment } } },
        { new: true }
    );

    if (!updatedReview) return res.status(404).json({ success: false, message: "Review not found" });

    // Populate the new reply's user info before sending back
    const populatedReview = await Review.findById(reviewId)
        .populate('userId', 'name')
        .populate('replies.userId', 'name');
        
    res.json({ success: true, message: "Reply added.", data: populatedReview });
}));

// PATCH: Edit a nested reply ⭐️ NEW ENDPOINT
router.patch('/reply/:reviewId/:replyId', asyncHandler(async (req, res) => {
    const { reviewId, replyId } = req.params;
    const { userId, comment } = req.body;

    if (!userId || !comment) {
        return res.status(400).json({ success: false, message: "userId and comment are required for update." });
    }

    // Use the array filter syntax to find the specific reply within the array
    const updatedReview = await Review.findOneAndUpdate(
        { 
            _id: reviewId, 
            'replies._id': replyId,
            'replies.userId': userId // Authorization check
        },
        { $set: { 'replies.$[reply].comment': comment } },
        { 
            new: true,
            arrayFilters: [ { 'reply._id': new mongoose.Types.ObjectId(replyId) } ]
        }
    );

    if (!updatedReview) {
        return res.status(404).json({ success: false, message: "Reply not found or user not authorized to edit." });
    }

    res.json({ success: true, message: "Reply updated successfully.", data: updatedReview });
}));

// Like/unlike a reply
router.patch('/reply/like/:reviewId/:replyId', asyncHandler(async (req, res) => {
    const { reviewId, replyId } = req.params;
    const { userId } = req.body;

    console.log('PATCH /api/reviews/reply/like/:reviewId/:replyId body:', req.body);

    if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required." });
    }

    // Check if the user has already liked the reply
    const review = await Review.findOne({ 
        _id: reviewId, 
        'replies._id': replyId,
        'replies.likes': userId 
    });

    let update;

    if (review) {
        // User already liked: $pull (unlike)
        update = { $pull: { 'replies.$[reply].likes': userId } };
    } else {
        // User not liked: $addToSet (like)
        update = { $addToSet: { 'replies.$[reply].likes': userId } };
    }

    // Correct arrayFilters syntax and cast replyId to ObjectId
    const updatedReview = await Review.findOneAndUpdate(
        { _id: reviewId },
        update,
        { 
            new: true,
            // The filter must match the placeholder 'reply' defined in the update path
            arrayFilters: [ { 'reply._id': new mongoose.Types.ObjectId(replyId) } ]
        }
    );

    if (!updatedReview) return res.status(404).json({ success: false, message: "Review or Reply not found" });

    res.json({ success: true, message: "Reply like status updated.", data: updatedReview });
}));

// Delete a reply (only reply owner can delete)
router.delete('/reply/:reviewId/:replyId', asyncHandler(async (req, res) => {
    const { reviewId, replyId } = req.params;
    const userId = req.query.userId || req.body.userId; // Get owner ID

    if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required to delete." });
    }

    // Use a single, efficient update query to check ownership and delete
    const result = await Review.findOneAndUpdate(
        { 
            _id: reviewId, 
            'replies._id': replyId,
            'replies.userId': userId // Check if the reply owner matches userId
        },
        { $pull: { replies: { _id: replyId } } },
        { new: true }
    );

    if (!result) {
        // Check if the review/reply exists but ownership failed
        const reviewCheck = await Review.findById(reviewId);
        if (!reviewCheck) return res.status(404).json({ success: false, message: "Review not found" });

        // If review exists but result is null, it means the userId didn't match the reply's userId
        return res.status(403).json({ success: false, message: "You can only delete your own reply." });
    }
    
    res.json({ success: true, message: "Reply deleted successfully." });
}));

// ================== EXPORT ==================
module.exports = router;
