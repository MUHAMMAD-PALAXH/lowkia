const express = require("express");
const router = express.Router();

const customerController = require("../controllers/customerController");
const validate = require("../middleware/validate");
const {
    createCustomerValidator,
    updateCustomerValidator,
    idValidator,
    listCustomerValidator
} = require("../validators/customerValidator");

// Base: /api/customers

router.get(
    "/",
    listCustomerValidator,
    validate,
    customerController.getCustomers
);

router.get("/stats", customerController.getCustomerStats);
router.get("/active", customerController.getActiveCustomers);
router.get("/reports/due", customerController.getDueReport);

router.post("/bulk-delete", customerController.bulkDeleteCustomers);
router.post("/bulk-restore", customerController.bulkRestoreCustomers);
router.post(
    "/bulk-permanent-delete",
    customerController.bulkPermanentDeleteCustomers
);

router.get(
    "/:id",
    idValidator,
    validate,
    customerController.getCustomerById
);

router.post(
    "/",
    createCustomerValidator,
    validate,
    customerController.createCustomer
);

router.put(
    "/:id",
    updateCustomerValidator,
    validate,
    customerController.updateCustomer
);

router.delete(
    "/:id",
    idValidator,
    validate,
    customerController.deleteCustomer
);

router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    customerController.permanentDeleteCustomer
);

router.patch(
    "/:id/restore",
    idValidator,
    validate,
    customerController.restoreCustomer
);

router.patch(
    "/:id/block",
    idValidator,
    validate,
    customerController.blockCustomer
);

router.patch(
    "/:id/activate",
    idValidator,
    validate,
    customerController.activateCustomer
);

module.exports = router;
