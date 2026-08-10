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
const controller = require("../controllers/employeeAdvanceController");
const {
    idValidator,
    employeeIdParamValidator,
    listValidator,
    createValidator,
    updateValidator,
    approveValidator,
    reasonValidator,
    disburseValidator,
    recoverValidator,
} = require("../validators/employeeAdvanceValidator");

// Base: /api/employee-advances
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);

router.get("/", listValidator, validate, controller.list);
router.post("/", createValidator, validate, controller.create);

router.get(
    "/employee/:employeeId/outstanding",
    employeeIdParamValidator,
    validate,
    controller.employeeOutstanding
);

router.get("/:id", idValidator, validate, controller.getById);
router.put("/:id", updateValidator, validate, controller.update);
router.patch("/:id", updateValidator, validate, controller.update);

router.post("/:id/submit", idValidator, validate, controller.submit);
router.post(
    "/:id/approve",
    financeOwnerOnly,
    approveValidator,
    validate,
    controller.approve
);
router.post(
    "/:id/reject",
    financeOwnerOnly,
    reasonValidator,
    validate,
    controller.reject
);
router.post("/:id/cancel", reasonValidator, validate, controller.cancel);
router.post(
    "/:id/disburse",
    financeOwnerOnly,
    disburseValidator,
    validate,
    controller.disburse
);
router.post(
    "/:id/recover",
    financeOwnerOnly,
    recoverValidator,
    validate,
    controller.recover
);
router.post(
    "/:id/reverse",
    financeOwnerOnly,
    reasonValidator,
    validate,
    controller.reverse
);

module.exports = router;
