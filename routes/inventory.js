const express = require("express");
const router = express.Router();

const inventoryController = require("../controllers/inventoryController");
const validate = require("../middleware/validate");
const { listValidator, idValidator } = require("../validators/inventoryValidator");

// Base: /api/inventory

router.get("/stats", inventoryController.getInventoryStats);

router.get(
    "/low-stock",
    listValidator,
    validate,
    inventoryController.getLowStock
);

router.get(
    "/movements",
    listValidator,
    validate,
    inventoryController.getStockMovements
);

router.get(
    "/imeis",
    listValidator,
    validate,
    inventoryController.getImeiStock
);

router.get("/", listValidator, validate, inventoryController.getInventoryList);

router.get(
    "/:id",
    idValidator,
    validate,
    inventoryController.getInventoryById
);

module.exports = router;
