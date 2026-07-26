const express = require("express");
const router = express.Router();

const branchController = require("../controllers/branchController");
const validate = require("../middleware/validate");
const {
    createBranchValidator,
    updateBranchValidator,
    assignWarehousesValidator,
    statusValidator,
    idValidator,
    listBranchValidator
} = require("../validators/branchValidator");

// Base: /api/branches
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

module.exports = router;
