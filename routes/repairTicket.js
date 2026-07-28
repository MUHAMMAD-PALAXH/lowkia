const express = require("express");
const router = express.Router();
const repairTicketController = require("../controllers/repairTicketController");

// Base: /api/repair-tickets
router.get("/", repairTicketController.getRepairTickets);
router.get("/stats", repairTicketController.getRepairTicketStats);
router.get("/:id", repairTicketController.getRepairTicketById);
router.post("/", repairTicketController.createRepairTicket);
router.put("/:id", repairTicketController.updateRepairTicket);
router.patch("/:id/status", repairTicketController.updateRepairTicketStatus);
router.patch("/:id/complete", repairTicketController.completeRepairTicket);
router.delete("/:id", repairTicketController.deleteRepairTicket);

module.exports = router;
