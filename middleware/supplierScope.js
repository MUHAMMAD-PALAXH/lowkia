const asyncHandler = require("express-async-handler");
const PurchaseOrder = require("../model/purchaseOrder");
const Supplier = require("../model/supplier");

const attachLinkedSupplier = asyncHandler(async (req, res, next) => {
    if (req.user?.role !== "supplier") return next();

    const supplier = await Supplier.findOne({
        userId: req.user._id,
        isDeleted: { $ne: true },
    });

    if (!supplier) {
        return res.status(403).json({
            success: false,
            message: "Supplier profile is not linked to this account.",
            data: null,
            errors: null,
        });
    }

    req.linkedSupplier = supplier;
    next();
});

const blockSupplier = (req, res, next) => {
    if (req.user?.role === "supplier") {
        return res.status(403).json({
            success: false,
            message: "Suppliers cannot perform this action.",
            data: null,
            errors: null,
        });
    }
    next();
};

const assertSupplierOwnsPo = asyncHandler(async (req, res, next) => {
    if (req.user?.role !== "supplier") return next();

    const po = await PurchaseOrder.findById(req.params.id).select("supplierId");
    if (!po) {
        return res.status(404).json({
            success: false,
            message: "Purchase order not found.",
            data: null,
            errors: null,
        });
    }

    if (String(po.supplierId) !== String(req.linkedSupplier._id)) {
        return res.status(403).json({
            success: false,
            message: "Access denied.",
            data: null,
            errors: null,
        });
    }

    next();
});

module.exports = {
    attachLinkedSupplier,
    blockSupplier,
    assertSupplierOwnsPo,
};
