const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    blockVendorFromFinance,
    financeStaffOnly,
} = require("../middleware/financeAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/supplierPayableController");
const {
    listValidator,
    idValidator,
    purchaseOrderIdValidator,
    supplierIdValidator,
    syncBodyValidator,
} = require("../validators/supplierPayableValidator");

// Base: /api/supplier-payables
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);

router.get("/", listValidator, validate, controller.listPayables);

router.get(
    "/by-po/:purchaseOrderId",
    purchaseOrderIdValidator,
    validate,
    controller.getByPurchaseOrder
);

router.post(
    "/sync/:purchaseOrderId",
    purchaseOrderIdValidator,
    syncBodyValidator,
    validate,
    controller.syncFromPurchaseOrder
);

router.get(
    "/supplier/:supplierId/outstanding",
    supplierIdValidator,
    validate,
    controller.getSupplierOutstanding
);

router.get(
    "/supplier/:supplierId",
    supplierIdValidator,
    listValidator,
    validate,
    controller.listBySupplier
);

router.get("/:id", idValidator, validate, controller.getPayableById);

module.exports = router;
