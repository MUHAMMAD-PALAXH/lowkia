const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");
const companyController = require("../controllers/companyController");

router.use(protect);

router.get("/me", resolveTenant, companyController.getMyCompany);
router.post(
    "/bootstrap",
    adminOnly,
    resolveTenant,
    companyController.bootstrapCompany
);

module.exports = router;
