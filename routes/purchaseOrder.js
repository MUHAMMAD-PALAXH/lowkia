const express = require("express");
const router = express.Router();

const purchaseOrderController = require("../controllers/purchaseOrderController");
const validate = require("../middleware/validate");
const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    attachLinkedSupplier,
    blockSupplier,
    assertSupplierOwnsPo,
} = require("../middleware/supplierScope");
const {
    blockVendorFromFinance,
    financeStaffOnly,
} = require("../middleware/financeAccess");
const { rateLimit } = require("../middleware/rateLimit");
const {
    createPurchaseOrderValidator,
    updatePurchaseOrderValidator,
    idValidator,
    productIdValidator,
    listValidator
} = require("../validators/purchaseOrderValidator");

// Base: /api/purchase-orders — authenticated only
router.use(protect, resolveTenant);
router.use(attachLinkedSupplier);
router.use(rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "po" }));

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
    blockSupplier,
    productIdValidator,
    validate,
    purchaseOrderController.getProductPurchaseContext
);

router.post("/bulk-delete", blockSupplier, purchaseOrderController.bulkDeletePurchaseOrders);
router.post("/bulk-restore", blockSupplier, purchaseOrderController.bulkRestorePurchaseOrders);
router.post(
    "/bulk-permanent-delete",
    blockSupplier,
    purchaseOrderController.bulkPermanentDeletePurchaseOrders
);

router.get(
    "/:id",
    idValidator,
    validate,
    assertSupplierOwnsPo,
    purchaseOrderController.getPurchaseOrderById
);

router.get(
    "/:id/delete-check",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.getPurchaseOrderDeleteCheck
);

router.post(
    "/:id/prepare-trash",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.prepareAndTrashPurchaseOrder
);

router.post(
    "/",
    blockSupplier,
    createPurchaseOrderValidator,
    validate,
    purchaseOrderController.createPurchaseOrder
);

router.put(
    "/:id",
    blockSupplier,
    updatePurchaseOrderValidator,
    validate,
    purchaseOrderController.updatePurchaseOrder
);

router.delete(
    "/:id",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.deletePurchaseOrder
);

router.delete(
    "/:id/permanent",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.permanentDeletePurchaseOrder
);

router.patch(
    "/:id/restore",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.restorePurchaseOrder
);

router.patch(
    "/:id/submit",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.submitPurchaseOrder
);

router.patch(
    "/:id/approve",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.approvePurchaseOrder
);

router.patch(
    "/:id/reject",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.rejectPurchaseOrder
);

router.patch(
    "/:id/order",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.markOrdered
);

router.patch(
    "/:id/supplier-accept",
    idValidator,
    validate,
    assertSupplierOwnsPo,
    purchaseOrderController.supplierAcceptPurchaseOrder
);

router.patch(
    "/:id/supplier-reject",
    idValidator,
    validate,
    assertSupplierOwnsPo,
    purchaseOrderController.supplierRejectPurchaseOrder
);

router.patch(
    "/:id/buyer-accept-demand",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.buyerAcceptDemand
);

router.patch(
    "/:id/buyer-reject-demand",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.buyerRejectDemand
);

router.patch(
    "/:id/send-new-demand",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.sendNewDemand
);

router.post(
    "/:id/supplier-send",
    idValidator,
    validate,
    assertSupplierOwnsPo,
    purchaseOrderController.supplierSendPurchaseOrder
);

router.post(
    "/:id/return-damaged",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.returnDamagedToSupplier
);

router.post(
    "/:id/supplier-ack-damaged",
    idValidator,
    validate,
    assertSupplierOwnsPo,
    purchaseOrderController.supplierAcknowledgeDamaged
);

router.post(
    "/:id/additional-phase",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.addAdditionalPhase
);

router.post(
    "/:id/supplier-payments",
    protect,
    resolveTenant,
    blockVendorFromFinance,
    financeStaffOnly,
    idValidator,
    validate,
    purchaseOrderController.recordSupplierPayment
);

router.patch(
    "/:id/cancel",
    blockSupplier,
    idValidator,
    validate,
    purchaseOrderController.cancelPurchaseOrder
);

module.exports = router;
