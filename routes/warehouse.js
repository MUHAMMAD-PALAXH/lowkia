const express = require("express");
const router = express.Router();

const warehouseController = require("../controllers/warehouseController");
const validate = require("../middleware/validate");
const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const {
    createWarehouseValidator,
    updateWarehouseValidator,
    assignBranchesValidator,
    statusValidator,
    idValidator,
    listWarehouseValidator
} = require("../validators/warehouseValidator");

// Base: /api/warehouses — authenticated only
router.use(protect, resolveTenant);

router.get(
    "/",
    listWarehouseValidator,
    validate,
    warehouseController.getWarehouses
);

router.get(
    "/active",
    warehouseController.getActiveWarehouses
);

router.get("/stats", warehouseController.getWarehouseStats);

router.post("/bulk-delete", warehouseController.bulkDeleteWarehouses);
router.post("/bulk-restore", warehouseController.bulkRestoreWarehouses);
router.post(
    "/bulk-permanent-delete",
    warehouseController.bulkPermanentDeleteWarehouses
);

router.get(
    "/:id",
    idValidator,
    validate,
    warehouseController.getWarehouseById
);

router.post(
    "/",
    createWarehouseValidator,
    validate,
    warehouseController.createWarehouse
);

router.put(
    "/:id",
    updateWarehouseValidator,
    validate,
    warehouseController.updateWarehouse
);

router.patch(
    "/:id/branches",
    assignBranchesValidator,
    validate,
    warehouseController.assignBranches
);

router.patch(
    "/:id/status",
    statusValidator,
    validate,
    warehouseController.setStatus
);

router.patch(
    "/:id/activate",
    idValidator,
    validate,
    warehouseController.activateWarehouse
);

router.patch(
    "/:id/deactivate",
    idValidator,
    validate,
    warehouseController.deactivateWarehouse
);

router.patch(
    "/:id/maintenance",
    idValidator,
    validate,
    warehouseController.setMaintenance
);

router.patch(
    "/:id/close",
    idValidator,
    validate,
    warehouseController.closeWarehouse
);

router.patch(
    "/:id/default",
    idValidator,
    validate,
    warehouseController.setDefault
);

router.delete(
    "/:id",
    idValidator,
    validate,
    warehouseController.deleteWarehouse
);

router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    warehouseController.permanentDeleteWarehouse
);

router.patch(
    "/:id/restore",
    idValidator,
    validate,
    warehouseController.restoreWarehouse
);

module.exports = router;
