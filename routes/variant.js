const express = require('express');
const router = express.Router();
const Variant = require('../model/variant');
const Product = require('../model/product');
const asyncHandler = require('express-async-handler');
const { protect } = require('../middleware/auth');
const { resolveTenant, requireCompany } = require('../middleware/tenant');
const { companyFilter, stampCompany } = require('../utils/tenantScope');
const { assertDocumentCompany } = require('../services/companyService');

router.use(protect, resolveTenant, requireCompany);

// Get all variants
router.get('/', asyncHandler(async (req, res) => {
    try {
        const variants = await Variant.find({ ...companyFilter(req.companyId) })
            .populate('variantTypeId')
            .sort({'variantTypeId': 1});
        res.json({ success: true, message: "Variants retrieved successfully.", data: variants });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get a variant by ID
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const variantID = req.params.id;
        const variant = await Variant.findById(variantID).populate('variantTypeId');
        if (!variant) {
            return res.status(404).json({ success: false, message: "Variant not found." });
        }
        assertDocumentCompany(variant, req.companyId, 'Variant');
        res.json({ success: true, message: "Variant retrieved successfully.", data: variant });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Create a new variant
router.post('/', asyncHandler(async (req, res) => {
    const { name, variantTypeId } = req.body;
    if (!name || !variantTypeId) {
        return res.status(400).json({ success: false, message: "Name and VariantType ID are required." });
    }

    try {
        const variant = new Variant(stampCompany({ name, variantTypeId }, req.companyId));
        await variant.save();
        res.json({ success: true, message: "Variant created successfully.", data: null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Update a variant
router.put('/:id', asyncHandler(async (req, res) => {
    const variantID = req.params.id;
    const { name, variantTypeId } = req.body;
    if (!name || !variantTypeId) {
        return res.status(400).json({ success: false, message: "Name and VariantType ID are required." });
    }

    try {
        const updatedVariant = await Variant.findOneAndUpdate(
            { _id: variantID, ...companyFilter(req.companyId) },
            { name, variantTypeId },
            { new: true }
        );
        if (!updatedVariant) {
            return res.status(404).json({ success: false, message: "Variant not found." });
        }
        res.json({ success: true, message: "Variant updated successfully.", data: null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Delete a variant
router.delete('/:id', asyncHandler(async (req, res) => {
    const variantID = req.params.id;
    const tenant = companyFilter(req.companyId);
    try {
        const products = await Product.find({ proVariantId: variantID, ...tenant });
        if (products.length > 0) {
            return res.status(400).json({ success: false, message: "Cannot delete variant. Products are referencing it." });
        }

        const variant = await Variant.findOneAndDelete({ _id: variantID, ...tenant });
        if (!variant) {
            return res.status(404).json({ success: false, message: "Variant not found." });
        }
        res.json({ success: true, message: "Variant deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));


module.exports = router;
