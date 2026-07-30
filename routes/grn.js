const express = require("express");
const router = express.Router();

const grnController = require("../controllers/grnController");
const validate = require("../middleware/validate");
const {
    idValidator,
    createFromPoValidator,
    updateGrnValidator,
    scanImeiValidator,
    bulkImeiValidator,
    listValidator
} = require("../validators/grnValidator");

// Base: /api/grn

router.get(
    "/receivable-pos",
    listValidator,
    validate,
    grnController.listReceivablePurchaseOrders
);

router.get("/stats", grnController.getGrnStats);

router.post("/bulk-delete", grnController.bulkDeleteGrns);
router.post("/bulk-restore", grnController.bulkRestoreGrns);
router.post("/bulk-permanent-delete", grnController.bulkPermanentDeleteGrns);

router.get("/", listValidator, validate, grnController.getGrns);

router.get("/:id", idValidator, validate, grnController.getGrnById);

router.post(
    "/from-po",
    createFromPoValidator,
    validate,
    grnController.createGrnFromPurchaseOrder
);

router.put("/:id", updateGrnValidator, validate, grnController.updateGrn);

router.patch(
    "/:id/scan-imei",
    scanImeiValidator,
    validate,
    grnController.scanImei
);

router.patch(
    "/:id/bulk-imeis",
    bulkImeiValidator,
    validate,
    grnController.bulkAddImeis
);

router.patch(
    "/:id/remove-imei",
    scanImeiValidator,
    validate,
    grnController.removeImei
);

router.patch("/:id/submit", idValidator, validate, grnController.submitGrn);

router.patch("/:id/approve", idValidator, validate, grnController.approveGrn);

router.patch("/:id/reject", idValidator, validate, grnController.rejectGrn);

router.patch(
    "/:id/complete",
    idValidator,
    validate,
    grnController.completeGrn
);

router.patch("/:id/cancel", idValidator, validate, grnController.cancelGrn);

router.delete("/:id", idValidator, validate, grnController.deleteGrn);

router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    grnController.permanentDeleteGrn
);

router.patch(
    "/:id/restore",
    idValidator,
    validate,
    grnController.restoreGrn
);

module.exports = router;
