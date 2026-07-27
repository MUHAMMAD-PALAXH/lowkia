const express = require("express");
const router = express.Router();

const salesOrderController = require("../controllers/salesOrderController");
const validate = require("../middleware/validate");
const {
    createSalesOrderValidator,
    updateSalesOrderValidator,
    idValidator,
    listValidator
} = require("../validators/salesOrderValidator");

// Base: /api/sales-orders

router.get("/", listValidator, validate, salesOrderController.getSalesOrders);
router.get("/stats", salesOrderController.getSalesOrderStats);

router.get(
    "/:id",
    idValidator,
    validate,
    salesOrderController.getSalesOrderById
);

router.post(
    "/",
    createSalesOrderValidator,
    validate,
    salesOrderController.createSalesOrder
);

router.put(
    "/:id",
    updateSalesOrderValidator,
    validate,
    salesOrderController.updateSalesOrder
);

router.delete(
    "/:id",
    idValidator,
    validate,
    salesOrderController.deleteSalesOrder
);

router.patch(
    "/:id/submit",
    idValidator,
    validate,
    salesOrderController.submitSalesOrder
);

router.patch(
    "/:id/approve",
    idValidator,
    validate,
    salesOrderController.approveSalesOrder
);

router.patch(
    "/:id/confirm",
    idValidator,
    validate,
    salesOrderController.confirmSalesOrder
);

router.patch(
    "/:id/complete",
    idValidator,
    validate,
    salesOrderController.completeSalesOrder
);

router.patch(
    "/:id/cancel",
    idValidator,
    validate,
    salesOrderController.cancelSalesOrder
);

module.exports = router;
