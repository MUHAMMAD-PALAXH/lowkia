const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    blockVendorFromFinance,
    financeStaffOnly,
    financeOwnerOnly,
} = require("../middleware/financeAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/employeePaymentController");
const {
    createValidator,
    listValidator,
    idValidator,
    reasonValidator,
    reverseValidator,
} = require("../validators/employeePaymentValidator");

// Base: /api/employee-payments
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);

router.get("/", listValidator, validate, controller.list);
router.post("/", createValidator, validate, controller.create);

router.get("/:id", idValidator, validate, controller.getById);
router.get("/:id/receipt", idValidator, validate, controller.receipt);

router.post(
    "/:id/approve",
    financeOwnerOnly,
    idValidator,
    reasonValidator,
    validate,
    controller.approve
);
router.post(
    "/:id/complete",
    financeOwnerOnly,
    idValidator,
    reasonValidator,
    validate,
    controller.complete
);
router.post(
    "/:id/cancel",
    idValidator,
    reasonValidator,
    validate,
    controller.cancel
);
router.post(
    "/:id/reverse",
    financeOwnerOnly,
    reverseValidator,
    validate,
    controller.reverse
);

module.exports = router;
