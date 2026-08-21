const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { resolveTenant, requireCompany } = require("../middleware/tenant");
const { attendanceAdminOnly, ownerOnly } = require("../middleware/hrAccess");
const validate = require("../middleware/validate");
const controller = require("../controllers/employeeController");
const {
    listValidator,
    createEmployeeValidator,
    updateEmployeeValidator,
    assignShiftValidator,
    idValidator
} = require("../validators/employeeValidator");

// Base: /api/employees
router.use(protect, resolveTenant, requireCompany, attendanceAdminOnly);

router.get("/", listValidator, validate, controller.getEmployees);
router.get("/available-users", controller.getAvailableUsers);
router.get("/:id", idValidator, validate, controller.getEmployeeById);
router.post("/", createEmployeeValidator, validate, controller.createEmployee);
router.put(
    "/:id",
    updateEmployeeValidator,
    validate,
    controller.updateEmployee
);
router.patch(
    "/:id/assign-shift",
    assignShiftValidator,
    validate,
    controller.assignShift
);
router.delete("/:id", idValidator, validate, controller.deleteEmployee);
router.patch(
    "/:id/restore",
    idValidator,
    validate,
    controller.restoreEmployee
);
router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    ownerOnly,
    controller.permanentDeleteEmployee
);

module.exports = router;
