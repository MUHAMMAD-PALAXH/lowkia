const express = require("express");
const router = express.Router();

const supplierController = require("../controllers/supplierController");
const validate = require("../middleware/validate");
const {
    createSupplierValidator,
    updateSupplierValidator,
    idValidator,
    listSupplierValidator,
    rateSupplierValidator
} = require("../validators/supplierValidator");

// ==========================================================
// Supplier Routes
// Base: /api/suppliers
// Auth will be attached after authentication phase
// ==========================================================

router.get(
    "/",
    listSupplierValidator,
    validate,
    supplierController.getSuppliers
);

router.get(
    "/active",
    supplierController.getActiveSuppliers
);

router.get("/stats", supplierController.getSupplierStats);

router.post("/bulk-delete", supplierController.bulkDeleteSuppliers);
router.post("/bulk-restore", supplierController.bulkRestoreSuppliers);
router.post(
    "/bulk-permanent-delete",
    supplierController.bulkPermanentDeleteSuppliers
);

router.get(
    "/reports/purchase",
    supplierController.getPurchaseReport
);

router.get(
    "/reports/due",
    supplierController.getDueReport
);

router.get(
    "/:id",
    idValidator,
    validate,
    supplierController.getSupplierById
);

router.post(
    "/",
    createSupplierValidator,
    validate,
    supplierController.createSupplier
);

router.put(
    "/:id",
    updateSupplierValidator,
    validate,
    supplierController.updateSupplier
);

router.delete(
    "/:id",
    idValidator,
    validate,
    supplierController.deleteSupplier
);

router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    supplierController.permanentDeleteSupplier
);

router.patch(
    "/:id/restore",
    idValidator,
    validate,
    supplierController.restoreSupplier
);

router.patch(
    "/:id/approve",
    idValidator,
    validate,
    supplierController.approveSupplier
);

router.patch(
    "/:id/block",
    idValidator,
    validate,
    supplierController.blockSupplier
);

router.patch(
    "/:id/activate",
    idValidator,
    validate,
    supplierController.activateSupplier
);

router.patch(
    "/:id/deactivate",
    idValidator,
    validate,
    supplierController.deactivateSupplier
);

router.patch(
    "/:id/rate",
    rateSupplierValidator,
    validate,
    supplierController.rateSupplier
);

module.exports = router;
