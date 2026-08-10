const express = require("express");
const router = express.Router();

const branchController = require("../controllers/branchController");
const validate = require("../middleware/validate");
const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    createBranchValidator,
    updateBranchValidator,
    assignWarehousesValidator,
    statusValidator,
    idValidator,
    listBranchValidator
} = require("../validators/branchValidator");

// Base: /api/branches — authenticated only
router.use(protect, resolveTenant);
// Auth will be attached after authentication phase

router.get(
    "/",
    listBranchValidator,
    validate,
    branchController.getBranches
);

router.get(
    "/active",
    branchController.getActiveBranches
);

router.get("/stats", branchController.getBranchStats);

router.post("/bulk-delete", branchController.bulkDeleteBranches);
router.post("/bulk-restore", branchController.bulkRestoreBranches);
router.post(
    "/bulk-permanent-delete",
    branchController.bulkPermanentDeleteBranches
);

router.get(
    "/:id",
    idValidator,
    validate,
    branchController.getBranchById
);

router.post(
    "/",
    createBranchValidator,
    validate,
    branchController.createBranch
);

router.put(
    "/:id",
    updateBranchValidator,
    validate,
    branchController.updateBranch
);

router.patch(
    "/:id/warehouses",
    assignWarehousesValidator,
    validate,
    branchController.assignWarehouses
);

router.patch(
    "/:id/status",
    statusValidator,
    validate,
    branchController.setStatus
);

router.patch(
    "/:id/activate",
    idValidator,
    validate,
    branchController.activateBranch
);

router.patch(
    "/:id/deactivate",
    idValidator,
    validate,
    branchController.deactivateBranch
);

router.patch(
    "/:id/maintenance",
    idValidator,
    validate,
    branchController.setMaintenance
);

router.patch(
    "/:id/close",
    idValidator,
    validate,
    branchController.closeBranch
);

router.patch(
    "/:id/head-office",
    idValidator,
    validate,
    branchController.setHeadOffice
);

router.delete(
    "/:id",
    idValidator,
    validate,
    branchController.deleteBranch
);

router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    branchController.permanentDeleteBranch
);

router.patch(
    "/:id/restore",
    idValidator,
    validate,
    branchController.restoreBranch
);

module.exports = router;
