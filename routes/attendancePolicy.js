const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const { attendanceAdminOnly, ownerOnly } = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/attendancePolicyController");
const {
    listValidator,
    createPolicyValidator,
    updatePolicyValidator,
    idValidator
} = require("../validators/attendancePolicyValidator");

// Base: /api/attendance-policies
router.use(protect, resolveTenant, requireCompany, attendanceAdminOnly);

router.get("/", listValidator, validate, controller.getPolicies);
router.get("/default", controller.getDefaultPolicy);
router.get("/:id", idValidator, validate, controller.getPolicyById);
router.post("/", createPolicyValidator, validate, controller.createPolicy);
router.put("/:id", updatePolicyValidator, validate, controller.updatePolicy);
router.patch(
    "/:id/set-default",
    idValidator,
    validate,
    ownerOnly,
    controller.setDefault
);
router.delete("/:id", idValidator, validate, controller.deletePolicy);
router.patch(
    "/:id/restore",
    idValidator,
    validate,
    controller.restorePolicy
);
router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    ownerOnly,
    controller.permanentDeletePolicy
);

module.exports = router;
