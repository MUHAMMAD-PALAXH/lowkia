const express = require('express');
const router = express.Router();
const VariantType = require('../model/variantType');
const Product = require('../model/product');
const Variant = require('../model/variant');
const asyncHandler = require('express-async-handler');
const { protect } = require('../middleware/auth');
const { resolveTenant, requireCompany } = require('../middleware/tenant');
const { companyFilter, stampCompany } = require('../utils/tenantScope');
const { assertDocumentCompany } = require('../services/companyService');

router.use(protect, resolveTenant, requireCompany);

// Get all variant types
router.get('/', asyncHandler(async (req, res) => {
    try {
        const variantTypes = await VariantType.find({ ...companyFilter(req.companyId) });
        res.json({ success: true, message: "VariantTypes retrieved successfully.", data: variantTypes });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Get a variant type by ID
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const variantTypeID = req.params.id;
        const variantType = await VariantType.findById(variantTypeID);
        if (!variantType) {
            return res.status(404).json({ success: false, message: "VariantType not found." });
        }
        assertDocumentCompany(variantType, req.companyId, 'VariantType');
        res.json({ success: true, message: "VariantType retrieved successfully.", data: variantType });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Create a new variant type
router.post('/', asyncHandler(async (req, res) => {
    const { name ,type } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: "Name is required." });
    }

    try {
        const variantType = new VariantType(stampCompany({ name , type }, req.companyId));
        await variantType.save();
        res.json({ success: true, message: "VariantType created successfully.", data: null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Update a variant type
router.put('/:id', asyncHandler(async (req, res) => {
    const variantTypeID = req.params.id;
    const { name ,type } = req.body;
    if (!name) {
        return res.status(400).json({ success: false, message: "Name is required." });
    }

    try {
        const updatedVariantType = await VariantType.findOneAndUpdate(
            { _id: variantTypeID, ...companyFilter(req.companyId) },
            { name , type},
            { new: true }
        );
        if (!updatedVariantType) {
            return res.status(404).json({ success: false, message: "VariantType not found." });
        }
        res.json({ success: true, message: "VariantType updated successfully.", data: null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));

// Delete a variant type
router.delete('/:id', asyncHandler(async (req, res) => {
    const variantTypeID = req.params.id;
    const tenant = companyFilter(req.companyId);
    try {
        const variantCount = await Variant.countDocuments({ variantTypeId: variantTypeID, ...tenant });
        if (variantCount > 0) {
            return res.status(400).json({ success: false, message: "Cannot delete variant type. It is associated with one or more variants." });
        }

        const products = await Product.find({ proVariantTypeId: variantTypeID, ...tenant });
        if (products.length > 0) {
            return res.status(400).json({ success: false, message: "Cannot delete variant type. Products are referencing it." });
        }

        const variantType = await VariantType.findOneAndDelete({ _id: variantTypeID, ...tenant });
        if (!variantType) {
            return res.status(404).json({ success: false, message: "Variant type not found." });
        }
        res.json({ success: true, message: "Variant type deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}));



module.exports = router;
