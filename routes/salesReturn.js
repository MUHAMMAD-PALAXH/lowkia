const express = require("express");
const router = express.Router();
const salesReturnController = require("../controllers/salesReturnController");

// Base: /api/sales-returns
router.get("/stats", salesReturnController.getReturnStats);
router.get(
    "/returnable/:salesOrderId",
    salesReturnController.getReturnableFromOrder
);

router.post("/bulk-delete", salesReturnController.bulkDeleteSalesReturns);
router.post("/bulk-restore", salesReturnController.bulkRestoreSalesReturns);
router.post(
    "/bulk-permanent-delete",
    salesReturnController.bulkPermanentDeleteSalesReturns
);

router.get("/", salesReturnController.getReturns);
router.get("/:id", salesReturnController.getReturnById);
router.post("/", salesReturnController.createReturn);
router.patch("/:id/receive", salesReturnController.receiveReturn);

router.delete("/:id", salesReturnController.deleteSalesReturn);
router.delete("/:id/permanent", salesReturnController.permanentDeleteSalesReturn);
router.patch("/:id/restore", salesReturnController.restoreSalesReturn);

module.exports = router;
