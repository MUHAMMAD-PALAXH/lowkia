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
const controller = require("../controllers/salaryStructureController");
const {
    idValidator,
    employeeIdParamValidator,
    listValidator,
    createValidator,
    updateValidator,
    assignValidator,
    previewValidator,
} = require("../validators/salaryStructureValidator");

// Base: /api/salary-structures
router.use(protect, resolveTenant, blockVendorFromFinance, financeStaffOnly);

router.get("/", listValidator, validate, controller.list);
router.post("/", financeOwnerOnly, createValidator, validate, controller.create);

router.get(
    "/employee/:employeeId",
    employeeIdParamValidator,
    validate,
    controller.getForEmployee
);

router.get("/:id", idValidator, validate, controller.getById);
router.put(
    "/:id",
    financeOwnerOnly,
    updateValidator,
    validate,
    controller.update
);
router.patch(
    "/:id",
    financeOwnerOnly,
    updateValidator,
    validate,
    controller.update
);

router.post(
    "/:id/assign",
    financeOwnerOnly,
    assignValidator,
    validate,
    controller.assign
);
router.post(
    "/:id/preview",
    previewValidator,
    validate,
    controller.preview
);
router.post(
    "/:id/archive",
    financeOwnerOnly,
    idValidator,
    validate,
    controller.archive
);

module.exports = router;
