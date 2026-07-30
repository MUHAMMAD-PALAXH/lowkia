const express = require("express");
const router = express.Router();

const purchaseOrderController = require("../controllers/purchaseOrderController");
const validate = require("../middleware/validate");
const {
    createPurchaseOrderValidator,
    updatePurchaseOrderValidator,
    idValidator,
    productIdValidator,
    listValidator
} = require("../validators/purchaseOrderValidator");

// Base: /api/purchase-orders

router.get(
    "/",
    listValidator,
    validate,
    purchaseOrderController.getPurchaseOrders
);

router.get("/stats", purchaseOrderController.getPurchaseOrderStats);

router.get(
    "/product-context/:productId",
    productIdValidator,
    validate,
    purchaseOrderController.getProductPurchaseContext
);

router.post("/bulk-delete", purchaseOrderController.bulkDeletePurchaseOrders);
router.post("/bulk-restore", purchaseOrderController.bulkRestorePurchaseOrders);
router.post(
    "/bulk-permanent-delete",
    purchaseOrderController.bulkPermanentDeletePurchaseOrders
);

router.get(
    "/:id",
    idValidator,
    validate,
    purchaseOrderController.getPurchaseOrderById
);

router.get(
    "/:id/delete-check",
    idValidator,
    validate,
    purchaseOrderController.getPurchaseOrderDeleteCheck
);

router.post(
    "/",
    createPurchaseOrderValidator,
    validate,
    purchaseOrderController.createPurchaseOrder
);

router.put(
    "/:id",
    updatePurchaseOrderValidator,
    validate,
    purchaseOrderController.updatePurchaseOrder
);

router.delete(
    "/:id",
    idValidator,
    validate,
    purchaseOrderController.deletePurchaseOrder
);

router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    purchaseOrderController.permanentDeletePurchaseOrder
);

router.patch(
    "/:id/restore",
    idValidator,
    validate,
    purchaseOrderController.restorePurchaseOrder
);

router.patch(
    "/:id/submit",
    idValidator,
    validate,
    purchaseOrderController.submitPurchaseOrder
);

router.patch(
    "/:id/approve",
    idValidator,
    validate,
    purchaseOrderController.approvePurchaseOrder
);

router.patch(
    "/:id/reject",
    idValidator,
    validate,
    purchaseOrderController.rejectPurchaseOrder
);

router.patch(
    "/:id/order",
    idValidator,
    validate,
    purchaseOrderController.markOrdered
);

router.patch(
    "/:id/supplier-accept",
    idValidator,
    validate,
    purchaseOrderController.supplierAcceptPurchaseOrder
);

router.patch(
    "/:id/supplier-reject",
    idValidator,
    validate,
    purchaseOrderController.supplierRejectPurchaseOrder
);

router.patch(
    "/:id/cancel",
    idValidator,
    validate,
    purchaseOrderController.cancelPurchaseOrder
);

module.exports = router;
