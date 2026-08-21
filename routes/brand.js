const express = require('express');
const router = express.Router();
const Brand = require('../model/brand');
const Product = require('../model/product');
const asyncHandler = require('express-async-handler');
const { protect } = require('../middleware/auth');
const { resolveTenant, requireCompany } = require('../middleware/tenant');
const { companyFilter, stampCompany } = require('../utils/tenantScope');
const { assertDocumentCompany } = require('../services/companyService');

router.use(protect, resolveTenant, requireCompany);

// Get all brands
router.get('/', asyncHandler(async (req, res) => {
    try {
        const brands = await Brand.find({ ...companyFilter(req.companyId) })
            .populate('subcategoryId')
            .sort({'subcategoryId': 1});
        res.json({ success: true, message: "Brands retrieved successfully.", data: brands });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get a brand by ID
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const brandID = req.params.id;
        const brand = await Brand.findById(brandID).populate('subcategoryId');
        if (!brand) {
            return res.status(404).json({ success: false, message: "Brand not found." });
        }
        assertDocumentCompany(brand, req.companyId, 'Brand');
        res.json({ success: true, message: "Brand retrieved successfully.", data: brand });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Create a new brand
router.post('/', asyncHandler(async (req, res) => {
    const { name, subcategoryId } = req.body;
    if (!name || !subcategoryId) {
        return res.status(400).json({ success: false, message: "Name and subcategory ID are required." });
    }

    try {
        const brand = new Brand(stampCompany({ name, subcategoryId }, req.companyId));
        await brand.save();
        res.json({ success: true, message: "Brand created successfully.", data: null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Update a brand
router.put('/:id', asyncHandler(async (req, res) => {
    const brandID = req.params.id;
    const { name, subcategoryId } = req.body;
    if (!name || !subcategoryId) {
        return res.status(400).json({ success: false, message: "Name and subcategory ID are required." });
    }

    try {
        const updatedBrand = await Brand.findOneAndUpdate(
            { _id: brandID, ...companyFilter(req.companyId) },
            { name, subcategoryId },
            { new: true }
        );
        if (!updatedBrand) {
            return res.status(404).json({ success: false, message: "Brand not found." });
        }
        res.json({ success: true, message: "Brand updated successfully.", data: null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Delete a brand
router.delete('/:id', asyncHandler(async (req, res) => {
    const brandID = req.params.id;
    const tenant = companyFilter(req.companyId);
    try {
        const products = await Product.find({ proBrandId: brandID, ...tenant });
        if (products.length > 0) {
            return res.status(400).json({ success: false, message: "Cannot delete brand. Products are referencing it." });
        }

        const brand = await Brand.findOneAndDelete({ _id: brandID, ...tenant });
        if (!brand) {
            return res.status(404).json({ success: false, message: "Brand not found." });
        }
        res.json({ success: true, message: "Brand deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));


module.exports = router;
