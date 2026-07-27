const express = require("express");
const router = express.Router();
const salesReturnController = require("../controllers/salesReturnController");

// Base: /api/sales-returns
router.get("/", salesReturnController.getReturns);
router.get("/:id", salesReturnController.getReturnById);
router.post("/", salesReturnController.createReturn);
router.patch("/:id/receive", salesReturnController.receiveReturn);

module.exports = router;
