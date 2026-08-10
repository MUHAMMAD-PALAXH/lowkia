const express = require("express");
const router = express.Router();
const repairTicketController = require("../controllers/repairTicketController");
const { protect } = require("../middleware/auth");
const { resolveTenant } = require("../middleware/tenant");

// Base: /api/repair-tickets — authenticated only
router.use(protect, resolveTenant);

router.get("/", repairTicketController.getRepairTickets);
router.get("/stats", repairTicketController.getRepairTicketStats);
router.get(
    "/lookup-imei/:imei",
    repairTicketController.lookupImeiWarranty
);
router.get("/:id", repairTicketController.getRepairTicketById);
router.post("/", repairTicketController.createRepairTicket);
router.put("/:id", repairTicketController.updateRepairTicket);
router.patch("/:id/status", repairTicketController.updateRepairTicketStatus);
router.patch("/:id/complete", repairTicketController.completeRepairTicket);
router.delete("/:id", repairTicketController.deleteRepairTicket);

module.exports = router;
