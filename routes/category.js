const express = require('express');
const router = express.Router();
const Category = require('../model/category');
const SubCategory = require('../model/subCategory');
const Product = require('../model/product');
const { uploadCategory } = require('../uploadFile');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
// Removed: const os = require('os'); 

// Removed: getLocalIP helper function as it's no longer needed.
// The image URL now comes directly from Cloudinary (req.file.path).

// --- GET ALL CATEGORIES ---
router.get('/', asyncHandler(async (req, res) => {
    // Error handling is handled by asyncHandler wrapping the try/catch block 
    // in the global error handler in index.js.
    const categories = await Category.find();
    res.json({ success: true, message: "Categories retrieved successfully.", data: categories });
}));

// --- GET A CATEGORY BY ID ---
router.get('/:id', asyncHandler(async (req, res) => {
    const categoryID = req.params.id;
    const category = await Category.findById(categoryID);
    
    if (!category) {
        return res.status(404).json({ success: false, message: "Category not found." });
    }
    res.json({ success: true, message: "Category retrieved successfully.", data: category });
}));

// --- CREATE A NEW CATEGORY WITH IMAGE UPLOAD ---
router.post('/', asyncHandler(async (req, res) => {
    // uploadCategory now uses Multer-Cloudinary-Storage
    uploadCategory.single('img')(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            // Handle Multer file limit errors
            const message = err.code === 'LIMIT_FILE_SIZE' ? 'File size is too large. Maximum filesize is 5MB.' : err.message;
            console.log(`Add category Multer Error: ${message}`);
            return res.status(400).json({ success: false, message: message });
        } else if (err) {
            // Handle general errors (including file type error from uploadFile.js)
            console.log(`Add category Error: ${err.message}`);
            return res.status(500).json({ success: false, message: err.message });
        }

        const { name } = req.body;
        let imageUrl = 'no_url';

        if (req.file) {
            // 🛑 CRITICAL CHANGE: Use the permanent URL provided by Cloudinary
            imageUrl = req.file.path; 
        }

        if (!name) {
            return res.status(400).json({ success: false, message: "Name is required." });
        }

        try {
            const newCategory = new Category({
                name: name,
                image: imageUrl
            });
            await newCategory.save();
            // Using 201 status for resource creation
            res.status(201).json({ success: true, message: "Category created successfully.", data: newCategory });
        } catch (error) {
            console.error("Error creating category:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    });
}));

// --- UPDATE A CATEGORY ---
router.put('/:id', asyncHandler(async (req, res) => {
    const categoryID = req.params.id;

    uploadCategory.single('img')(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
             const message = err.code === 'LIMIT_FILE_SIZE' ? 'File size is too large. Maximum filesize is 5MB.' : err.message;
            console.log(`Update category Multer Error: ${message}`);
            return res.status(400).json({ success: false, message: message });
        } else if (err) {
            console.log(`Update category Error: ${err.message}`);
            return res.status(500).json({ success: false, message: err.message });
        }

        const { name } = req.body;
        let image = req.body.image; // Existing image URL if not uploading a new file

        if (req.file) {
            // 🛑 CRITICAL CHANGE: Use the permanent URL provided by Cloudinary
            image = req.file.path; 
        }

        if (!name || !image) {
            return res.status(400).json({ success: false, message: "Name and image are required." });
        }

        try {
            const updatedCategory = await Category.findByIdAndUpdate(categoryID, { name: name, image: image }, { new: true });
            
            if (!updatedCategory) {
                return res.status(404).json({ success: false, message: "Category not found." });
            }
            res.json({ success: true, message: "Category updated successfully.", data: updatedCategory });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });
}));

// --- DELETE A CATEGORY ---
router.delete('/:id', asyncHandler(async (req, res) => {
    const categoryID = req.params.id;

    // Check references before deletion
    const subcategories = await SubCategory.find({ categoryId: categoryID });
    if (subcategories.length > 0) {
        return res.status(400).json({ success: false, message: "Cannot delete category. Subcategories are referencing it." });
    }

    const products = await Product.find({ proCategoryId: categoryID });
    if (products.length > 0) {
        return res.status(400).json({ success: false, message: "Cannot delete category. Products are referencing it." });
    }

    const category = await Category.findByIdAndDelete(categoryID);
    if (!category) {
        return res.status(404).json({ success: false, message: "Category not found." });
    }
    
    // NOTE: For true production, you should add logic here to delete the 
    // image file from Cloudinary using the stored URL/Public ID before 
    // returning the success response.
    
    res.json({ success: true, message: "Category deleted successfully." });
}));

module.exports = router;